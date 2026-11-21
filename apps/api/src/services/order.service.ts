import {
  calculateOrder,
  type OrderAdminEditInput,
  type OrderCalc,
  type OrderCreateInput,
  type OrderStatus,
  orderDeliverySchema,
  orderInvoiceSchema,
  orderListQuerySchema,
  orderReturnSchema,
  orderStatusSchema,
  paymentInputSchema,
  type Role,
  sofiaToday,
} from '@ba/shared';
import type { z } from 'zod';
import { many, one, type Queryable, withTx } from '../db/pool.js';
import type { Deps } from '../deps.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../types.js';
import type { NotificationService, Target } from './notification.service.js';
import { effectiveCommission } from './party.service.js';

export interface OrderRow {
  id: string;
  number: number;
  producer_id: string;
  merchant_id: string;
  producer_name: string;
  merchant_name: string;
  status: OrderStatus;
  order_date: string;
  merchant_ref: string | null;
  requested_delivery_on: string | null;
  note: string | null;
  created_by_role: Role;
  delivery_method: string;
  delivery_note: string | null;
  planned_delivery_on: string | null;
  delivered_on: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_method: string;
  invoice_note: string | null;
  invoice_receive_method: string;
  commission_bp: number;
  returned_net_cents: number;
  returned_note: string | null;
  cancel_reason: string | null;
  net_cents: number;
  gross_cents: number;
  commission_cents: number;
  created_at: string;
  updated_at: string;
}

const ORDER_SELECT = `SELECT o.*, p.name AS producer_name, m.name AS merchant_name
  FROM orders o JOIN producers p ON p.id = o.producer_id JOIN merchants m ON m.id = o.merchant_id`;

/** Who may move an order from one status to another. */
const TRANSITIONS: Record<Role, Partial<Record<OrderStatus, OrderStatus[]>>> = {
  admin: { new: ['confirmed', 'delivered', 'cancelled'], confirmed: ['new', 'delivered', 'cancelled'], delivered: ['confirmed'], cancelled: ['new'] },
  producer: { new: ['confirmed', 'cancelled'], confirmed: ['delivered', 'cancelled'] },
  merchant: { new: ['cancelled'] },
};

type Calcable = { id: string; status: OrderStatus; commission_bp: number; returned_net_cents: number };

/** What a merchant may see of the totals: the commission is between the producer and me (art. 20). */
function merchantCalc(c: OrderCalc) {
  return {
    netCents: c.netCents,
    vatCents: c.vatCents,
    grossCents: c.grossCents,
    returnedNetCents: c.returnedNetCents,
    baseNetCents: c.baseNetCents,
    payableGrossCents: c.payableGrossCents,
    paidCents: c.paidCents,
    paymentStatus: c.paymentStatus,
  };
}

function stripCommission(row: OrderRow): Omit<OrderRow, 'commission_bp' | 'commission_cents'> {
  const { commission_bp: _a, commission_cents: _b, ...rest } = row;
  return rest;
}

export class OrderService {
  constructor(
    private readonly deps: Pick<Deps, 'db' | 'now' | 'log'>,
    private readonly notifications: NotificationService,
  ) {}

  private today() {
    return sofiaToday(this.deps.now());
  }

  // ─── Reading ───

  private scope(actor: Actor, params: unknown[]): string {
    if (actor.role === 'producer') return `o.producer_id = $${params.push(actor.producerId)}`;
    if (actor.role === 'merchant') return `o.merchant_id = $${params.push(actor.merchantId)}`;
    return 'true';
  }

  /** Totals and commission for many orders at once, with calculateOrder() as the only formula. */
  async calcFor(db: Queryable, orders: Calcable[]): Promise<Map<string, OrderCalc>> {
    const ids = orders.map((o) => o.id);
    const out = new Map<string, OrderCalc>();
    if (!ids.length) return out;
    // Sequential: `db` may be a transaction client, which runs one query at a time.
    const items = await many<{ order_id: string; quantity_milli: number; unit_price_cents: number; vat_bp: number }>(db, 'SELECT order_id, quantity_milli, unit_price_cents, vat_bp FROM order_items WHERE order_id = ANY($1)', [ids]);
    const payments = await many<{ order_id: string; amount_cents: number; paid_on: string }>(db, 'SELECT order_id, amount_cents, paid_on FROM order_payments WHERE order_id = ANY($1)', [ids]);
    const commissions = await many<{ order_id: string; amount_cents: number }>(db, 'SELECT order_id, amount_cents FROM commission_payments WHERE order_id = ANY($1)', [ids]);
    const today = this.today();
    for (const o of orders) {
      out.set(
        o.id,
        calculateOrder({
          lines: items.filter((i) => i.order_id === o.id).map((i) => ({ quantityMilli: i.quantity_milli, unitPriceCents: i.unit_price_cents, vatBp: i.vat_bp })),
          returnedNetCents: o.returned_net_cents,
          // A cancelled order earns nothing.
          commissionBp: o.status === 'cancelled' ? 0 : o.commission_bp,
          payments: payments.filter((p) => p.order_id === o.id).map((p) => ({ amountCents: p.amount_cents, paidOn: p.paid_on })),
          commissionPayments: commissions.filter((p) => p.order_id === o.id).map((p) => ({ amountCents: p.amount_cents })),
          today,
        }),
      );
    }
    return out;
  }

  async list(actor: Actor, query: z.output<typeof orderListQuerySchema>) {
    const params: unknown[] = [];
    const where = [this.scope(actor, params)];
    if (query.status) where.push(`o.status = $${params.push(query.status)}`);
    if (query.producer_id) where.push(`o.producer_id = $${params.push(query.producer_id)}`);
    if (query.merchant_id) where.push(`o.merchant_id = $${params.push(query.merchant_id)}`);
    if (query.from) where.push(`o.order_date >= $${params.push(query.from)}`);
    if (query.to) where.push(`o.order_date <= $${params.push(query.to)}`);
    if (query.q) {
      const n = params.push(`%${query.q}%`);
      where.push(`(o.number::text ILIKE $${n} OR p.name ILIKE $${n} OR m.name ILIKE $${n} OR o.merchant_ref ILIKE $${n} OR o.invoice_number ILIKE $${n})`);
    }
    const rows = await many<OrderRow>(this.deps.db, `${ORDER_SELECT} WHERE ${where.join(' AND ')} ORDER BY o.order_date DESC, o.number DESC LIMIT 500`, params);
    const calcs = await this.calcFor(this.deps.db, rows);
    return rows.map((r) => {
      const calc = calcs.get(r.id)!;
      return actor.role === 'merchant' ? { ...stripCommission(r), calc: merchantCalc(calc) } : { ...r, calc };
    });
  }

  private async load(db: Queryable, actor: Actor, id: string, lock = false): Promise<OrderRow> {
    const o = await one<OrderRow>(db, `${ORDER_SELECT} WHERE o.id = $1${lock ? ' FOR UPDATE OF o' : ''}`, [id]);
    if (!o) throw new AppError('not_found');
    if (actor.role === 'producer' && o.producer_id !== actor.producerId) throw new AppError('not_found');
    if (actor.role === 'merchant' && o.merchant_id !== actor.merchantId) throw new AppError('not_found');
    return o;
  }

  async get(actor: Actor, id: string) {
    const o = await this.load(this.deps.db, actor, id);
    const [items, payments, commissionPayments, events, requests, producer, merchant] = await Promise.all([
      many(this.deps.db, `SELECT oi.*, g.active AND NOT g.archived AS good_available FROM order_items oi LEFT JOIN goods g ON g.id = oi.good_id WHERE oi.order_id = $1 ORDER BY oi.sort_order, oi.name_bg`, [id]),
      many(this.deps.db, 'SELECT id, amount_cents, paid_on, note, created_at FROM order_payments WHERE order_id = $1 ORDER BY paid_on, created_at', [id]),
      actor.role === 'merchant' ? Promise.resolve([]) : many(this.deps.db, 'SELECT id, amount_cents, paid_on, note, created_at FROM commission_payments WHERE order_id = $1 ORDER BY paid_on, created_at', [id]),
      many<{ type: string }>(
        this.deps.db,
        `SELECT e.id, e.type, e.role, e.data, e.created_at, u.email AS user_email, u.name AS user_name FROM order_events e LEFT JOIN users u ON u.id = e.user_id
          WHERE e.order_id = $1 ORDER BY e.id DESC`,
        [id],
      ),
      many(
        this.deps.db,
        `SELECT r.id, r.number, r.good_id, g.name_bg AS good_name, r.status, r.current_price_cents, r.proposed_price_cents, r.new_price_cents, r.description, r.response,
                r.requested_by_role, r.created_at, r.resolved_at
           FROM price_requests r JOIN goods g ON g.id = r.good_id WHERE r.order_id = $1 ORDER BY r.created_at DESC`,
        [id],
      ),
      one(this.deps.db, 'SELECT id, name, eik, phone, email, address, contact_person FROM producers WHERE id = $1', [o.producer_id]),
      one(this.deps.db, 'SELECT id, name, eik, phone, email, address, contact_person, invoice_email, delivery_note FROM merchants WHERE id = $1', [o.merchant_id]),
    ]);
    const calc = (await this.calcFor(this.deps.db, [o])).get(id)!;
    const base = { items, payments, requests, producer, merchant };
    if (actor.role === 'merchant') {
      return { ...stripCommission(o), ...base, events: events.filter((e) => !e.type.startsWith('commission')), calc: merchantCalc(calc) };
    }
    return { ...o, ...base, commission_payments: commissionPayments, events, calc };
  }

  // ─── Helpers ───

  private async event(db: Queryable, orderId: string, actor: Actor, type: string, data: Record<string, unknown> = {}) {
    await db.query('INSERT INTO order_events (order_id, user_id, role, type, data) VALUES ($1, $2, $3, $4, $5)', [orderId, actor.userId || null, actor.role, type, JSON.stringify(data)]);
  }

  /** Refreshes the cached totals of an order. */
  async recompute(db: Queryable, orderId: string): Promise<OrderCalc> {
    const o = await one<Calcable>(db, 'SELECT id, status, commission_bp, returned_net_cents FROM orders WHERE id = $1', [orderId]);
    const calc = (await this.calcFor(db, [o!])).get(orderId)!;
    await db.query('UPDATE orders SET net_cents = $2, gross_cents = $3, commission_cents = $4, updated_at = now() WHERE id = $1', [orderId, calc.netCents, calc.grossCents, calc.commissionCents]);
    return calc;
  }

  /** Notifies every party of the order except the one who acted. */
  private async notifyParties(db: Queryable, actor: Actor, o: OrderRow, type: Parameters<NotificationService['notify']>[2], data: Record<string, unknown>, parties: Role[] = ['admin', 'producer', 'merchant']) {
    const link = `/orders/${o.id}`;
    const base = { number: o.number, producer: o.producer_name, merchant: o.merchant_name, ...data };
    const targets: [Role, Target][] = [
      ['admin', { audience: 'admin' }],
      ['producer', { audience: 'producer', producerId: o.producer_id }],
      ['merchant', { audience: 'merchant', merchantId: o.merchant_id }],
    ];
    for (const [role, target] of targets) {
      if (role === actor.role || !parties.includes(role)) continue;
      await this.notifications.notify(db, target, type, base, link);
    }
  }

  private requireRole(actor: Actor, ...roles: Role[]) {
    if (!roles.includes(actor.role)) throw new AppError('forbidden');
  }

  // ─── Creating ───

  async create(actor: Actor, input: OrderCreateInput): Promise<{ id: string; number: number }> {
    const producerId = actor.role === 'producer' ? actor.producerId! : input.producer_id;
    const merchantId = actor.role === 'merchant' ? actor.merchantId! : input.merchant_id;
    const fields: Record<string, string> = {};
    if (!producerId) fields.producer_id = 'validation.required';
    if (!merchantId) fields.merchant_id = 'validation.required';
    if (Object.keys(fields).length) throw new AppError('validation_failed', { fields });
    const orderDate = input.order_date ?? this.today();

    const result = await withTx(this.deps.db, async (tx) => {
      const producer = await one<{ id: string; name: string; active: boolean; commission_bp: number; delivery_method: string; delivery_note: string | null; invoice_method: string; invoice_note: string | null }>(
        tx,
        'SELECT id, name, active, commission_bp, delivery_method, delivery_note, invoice_method, invoice_note FROM producers WHERE id = $1',
        [producerId],
      );
      const merchant = await one<{ id: string; name: string; active: boolean; invoice_method: string }>(tx, 'SELECT id, name, active, invoice_method FROM merchants WHERE id = $1', [merchantId]);
      if (!producer || !merchant || (actor.role !== 'admin' && (!producer.active || !merchant.active))) throw new AppError('not_found');

      const goodIds = [...new Set(input.items.map((i) => i.good_id))];
      const goods = await many<{ id: string; producer_id: string; name_bg: string; name_en: string | null; sku: string | null; unit: string; price_cents: number; vat_bp: number; active: boolean; archived: boolean }>(
        tx,
        'SELECT id, producer_id, name_bg, name_en, sku, unit, price_cents, vat_bp, active, archived FROM goods WHERE id = ANY($1)',
        [goodIds],
      );
      const byId = new Map(goods.map((g) => [g.id, g]));
      input.items.forEach((it, i) => {
        const g = byId.get(it.good_id);
        if (!g || g.producer_id !== producerId || g.archived || (!g.active && actor.role !== 'admin')) fields[`items.${i}.good_id`] = 'validation.good_unavailable';
      });
      if (Object.keys(fields).length) throw new AppError('good_unavailable', { fields });

      // The relationship (Приложение № 1) starts with the first order unless the admin set it up already.
      await tx.query(
        `INSERT INTO producer_merchants (producer_id, merchant_id, introduced_on, introduced_how) VALUES ($1, $2, $3, 'platform') ON CONFLICT (producer_id, merchant_id) DO NOTHING`,
        [producerId, merchantId, orderDate],
      );
      const pair = await one<{ status: string; commission_bp: number | null; producer_commission_bp: number }>(
        tx,
        'SELECT pm.status, pm.commission_bp, p.commission_bp AS producer_commission_bp FROM producer_merchants pm JOIN producers p ON p.id = pm.producer_id WHERE pm.producer_id = $1 AND pm.merchant_id = $2',
        [producerId, merchantId],
      );
      const commissionBp = effectiveCommission(pair);

      // The first time a good is ordered by this merchant its price is locked; afterwards only the admin changes it.
      const agreed = new Map(
        (await many<{ good_id: string; price_cents: number }>(tx, 'SELECT good_id, price_cents FROM agreed_prices WHERE merchant_id = $1 AND good_id = ANY($2)', [merchantId, goodIds])).map((a) => [
          a.good_id,
          a.price_cents,
        ]),
      );
      for (const gid of goodIds) {
        if (agreed.has(gid)) continue;
        const g = byId.get(gid)!;
        await tx.query('INSERT INTO agreed_prices (good_id, merchant_id, price_cents) VALUES ($1, $2, $3) ON CONFLICT (good_id, merchant_id) DO NOTHING', [gid, merchantId, g.price_cents]);
        agreed.set(gid, g.price_cents);
      }

      const order = await one<{ id: string; number: number }>(
        tx,
        `INSERT INTO orders (producer_id, merchant_id, order_date, merchant_ref, requested_delivery_on, note, created_by, created_by_role,
                delivery_method, delivery_note, invoice_method, invoice_note, invoice_receive_method, commission_bp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, number`,
        [
          producerId,
          merchantId,
          orderDate,
          input.merchant_ref,
          input.requested_delivery_on,
          input.note,
          actor.userId || null,
          actor.role,
          producer.delivery_method,
          producer.delivery_note,
          producer.invoice_method,
          producer.invoice_note,
          merchant.invoice_method,
          commissionBp,
        ],
      );
      let sort = 0;
      for (const it of input.items) {
        const g = byId.get(it.good_id)!;
        await tx.query(
          `INSERT INTO order_items (order_id, good_id, name_bg, name_en, sku, unit, quantity_milli, unit_price_cents, vat_bp, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [order!.id, g.id, g.name_bg, g.name_en, g.sku, g.unit, it.quantity, agreed.get(g.id)!, g.vat_bp, sort++],
        );
      }
      const calc = await this.recompute(tx, order!.id);
      await this.event(tx, order!.id, actor, 'created', { net: calc.netCents });

      // An order closes the merchant's open reminders for this producer (or general ones).
      await tx.query(
        `UPDATE reminders SET status = 'done', updated_at = now() WHERE merchant_id = $1 AND status = 'open' AND (producer_id IS NULL OR producer_id = $2)`,
        [merchantId, producerId],
      );

      const row = await this.load(tx, actor, order!.id);
      await this.notifyParties(tx, actor, row, 'order_created', { net: calc.netCents, by: actor.role });
      return order!;
    });
    return result;
  }

  // ─── Changing ───

  /** Admin only: lines, quantities, prices, commission and returns. */
  async adminEdit(actor: Actor, id: string, input: OrderAdminEditInput) {
    this.requireRole(actor, 'admin');
    await withTx(this.deps.db, async (tx) => {
      const o = await this.load(tx, actor, id, true);
      const existing = await many<{ id: string; good_id: string | null }>(tx, 'SELECT id, good_id FROM order_items WHERE order_id = $1', [id]);
      const existingIds = new Set(existing.map((e) => e.id));
      const goodIds = [...new Set(input.items.map((i) => i.good_id))];
      const goods = new Map(
        (await many<{ id: string; producer_id: string; name_bg: string; name_en: string | null; sku: string | null; unit: string }>(tx, 'SELECT id, producer_id, name_bg, name_en, sku, unit FROM goods WHERE id = ANY($1)', [goodIds])).map(
          (g) => [g.id, g],
        ),
      );
      const fields: Record<string, string> = {};
      input.items.forEach((it, i) => {
        if (it.id && !existingIds.has(it.id)) fields[`items.${i}.id`] = 'validation.invalid';
        const g = goods.get(it.good_id);
        if (!g || g.producer_id !== o.producer_id) fields[`items.${i}.good_id`] = 'validation.good_unavailable';
      });
      if (Object.keys(fields).length) throw new AppError('validation_failed', { fields });

      const before = o.net_cents;
      const keep = new Set(input.items.map((i) => i.id).filter(Boolean));
      for (const e of existing) if (!keep.has(e.id)) await tx.query('DELETE FROM order_items WHERE id = $1', [e.id]);
      let sort = 0;
      for (const it of input.items) {
        const g = goods.get(it.good_id)!;
        if (it.id) {
          await tx.query(
            `UPDATE order_items SET good_id=$2, name_bg=$3, name_en=$4, sku=$5, unit=$6, quantity_milli=$7, unit_price_cents=$8, vat_bp=$9, sort_order=$10 WHERE id=$1`,
            [it.id, g.id, g.name_bg, g.name_en, g.sku, g.unit, it.quantity, it.unit_price, it.vat_percent, sort++],
          );
        } else {
          await tx.query(
            `INSERT INTO order_items (order_id, good_id, name_bg, name_en, sku, unit, quantity_milli, unit_price_cents, vat_bp, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [id, g.id, g.name_bg, g.name_en, g.sku, g.unit, it.quantity, it.unit_price, it.vat_percent, sort++],
          );
        }
        if (input.update_agreed_prices) {
          await tx.query(
            `INSERT INTO agreed_prices (good_id, merchant_id, price_cents) VALUES ($1, $2, $3)
             ON CONFLICT (good_id, merchant_id) DO UPDATE SET price_cents = EXCLUDED.price_cents, updated_at = now()`,
            [g.id, o.merchant_id, it.unit_price],
          );
        }
      }
      await tx.query('UPDATE orders SET commission_bp = $2, returned_net_cents = $3, returned_note = $4 WHERE id = $1', [id, input.commission_percent, input.returned_net, input.returned_note]);
      const calc = await this.recompute(tx, id);
      await this.event(tx, id, actor, 'edited', { before, after: calc.netCents, commission_bp: input.commission_percent });
      await this.notifyParties(tx, actor, o, 'order_changed', { net: calc.netCents }, ['producer', 'merchant']);
    });
    return this.get(actor, id);
  }

  async setStatus(actor: Actor, id: string, input: z.output<typeof orderStatusSchema>) {
    await withTx(this.deps.db, async (tx) => {
      const o = await this.load(tx, actor, id, true);
      if (o.status === input.status) return;
      if (!TRANSITIONS[actor.role][o.status]?.includes(input.status)) throw new AppError('invalid_state');
      const today = this.today();
      await tx.query(
        `UPDATE orders SET status = $2,
                delivered_on = CASE WHEN $2 = 'delivered' THEN coalesce(delivered_on, $3::date) WHEN $2 IN ('new', 'confirmed') THEN NULL ELSE delivered_on END,
                cancel_reason = CASE WHEN $2 = 'cancelled' THEN $4 ELSE NULL END, updated_at = now()
          WHERE id = $1`,
        [id, input.status, today, input.reason],
      );
      await this.recompute(tx, id);
      await this.event(tx, id, actor, 'status', { from: o.status, to: input.status, reason: input.reason });
      const fresh = await this.load(tx, actor, id);
      const type = ({ confirmed: 'order_confirmed', delivered: 'order_delivered', cancelled: 'order_cancelled', new: 'order_changed' } as const)[input.status];
      await this.notifyParties(tx, actor, fresh, type, { planned: fresh.planned_delivery_on, delivered: fresh.delivered_on, reason: input.reason, net: fresh.net_cents });
    });
    return this.get(actor, id);
  }

  /** The producer says when and how it delivers. A delivery date marks the order delivered. */
  async updateDelivery(actor: Actor, id: string, input: z.output<typeof orderDeliverySchema>) {
    this.requireRole(actor, 'admin', 'producer');
    await withTx(this.deps.db, async (tx) => {
      const o = await this.load(tx, actor, id, true);
      if (o.status === 'cancelled') throw new AppError('invalid_state');
      const deliveredNow = Boolean(input.delivered_on) && o.status !== 'delivered';
      await tx.query(
        `UPDATE orders SET delivery_method = $2, delivery_note = $3, planned_delivery_on = $4, delivered_on = $5,
                status = CASE WHEN $5::date IS NOT NULL THEN 'delivered' WHEN status = 'delivered' THEN 'confirmed' ELSE status END, updated_at = now()
          WHERE id = $1`,
        [id, input.delivery_method, input.delivery_note, input.planned_delivery_on, input.delivered_on],
      );
      await this.event(tx, id, actor, 'delivery', input);
      if (deliveredNow) {
        const fresh = await this.load(tx, actor, id);
        await this.notifyParties(tx, actor, fresh, 'order_delivered', { delivered: fresh.delivered_on });
      }
    });
    return this.get(actor, id);
  }

  async updateInvoice(actor: Actor, id: string, input: z.output<typeof orderInvoiceSchema>) {
    this.requireRole(actor, 'admin', 'producer');
    await withTx(this.deps.db, async (tx) => {
      await this.load(tx, actor, id, true);
      await tx.query('UPDATE orders SET invoice_number = $2, invoice_date = $3, invoice_method = $4, invoice_note = $5, updated_at = now() WHERE id = $1', [
        id,
        input.invoice_number,
        input.invoice_date,
        input.invoice_method,
        input.invoice_note,
      ]);
      await this.event(tx, id, actor, 'invoice', input);
    });
    return this.get(actor, id);
  }

  /** Returned or credited goods (art. 10): lower the commission base. */
  async updateReturn(actor: Actor, id: string, input: z.output<typeof orderReturnSchema>) {
    this.requireRole(actor, 'admin', 'producer');
    await withTx(this.deps.db, async (tx) => {
      const o = await this.load(tx, actor, id, true);
      await tx.query('UPDATE orders SET returned_net_cents = $2, returned_note = $3 WHERE id = $1', [id, input.returned_net, input.returned_note]);
      const calc = await this.recompute(tx, id);
      await this.event(tx, id, actor, 'returned', { amount: input.returned_net, note: input.returned_note });
      if (actor.role === 'producer') await this.notifyParties(tx, actor, o, 'order_changed', { net: calc.netCents }, ['admin']);
    });
    return this.get(actor, id);
  }

  /** The merchant paid the producer: the commission accrues (art. 8). */
  async addPayment(actor: Actor, id: string, input: z.output<typeof paymentInputSchema>) {
    this.requireRole(actor, 'admin', 'producer');
    await withTx(this.deps.db, async (tx) => {
      const o = await this.load(tx, actor, id, true);
      if (o.status === 'cancelled') throw new AppError('invalid_state');
      await tx.query('INSERT INTO order_payments (order_id, amount_cents, paid_on, note, created_by) VALUES ($1, $2, $3, $4, $5)', [id, input.amount, input.paid_on, input.note, actor.userId || null]);
      const calc = (await this.calcFor(tx, [o])).get(id)!;
      const tranche = calc.tranches.find((t) => t.paidOn === input.paid_on);
      await this.event(tx, id, actor, 'payment', { amount: input.amount, paid_on: input.paid_on });
      await this.notifyParties(tx, actor, o, 'payment_recorded', { amount: input.amount, paidOn: input.paid_on, commissionDueOn: tranche?.dueOn ?? null }, ['admin', 'producer']);
    });
    return this.get(actor, id);
  }

  async deletePayment(actor: Actor, id: string, paymentId: string) {
    this.requireRole(actor, 'admin', 'producer');
    await withTx(this.deps.db, async (tx) => {
      await this.load(tx, actor, id, true);
      const r = await one<{ amount_cents: number; paid_on: string }>(tx, 'DELETE FROM order_payments WHERE id = $1 AND order_id = $2 RETURNING amount_cents, paid_on', [paymentId, id]);
      if (!r) throw new AppError('not_found');
      await this.event(tx, id, actor, 'payment_deleted', { amount: r.amount_cents, paid_on: r.paid_on });
    });
    return this.get(actor, id);
  }

  /** What the producer paid me for this order. */
  async addCommissionPayment(actor: Actor, id: string, input: z.output<typeof paymentInputSchema>) {
    this.requireRole(actor, 'admin');
    await withTx(this.deps.db, async (tx) => {
      const o = await this.load(tx, actor, id, true);
      await tx.query('INSERT INTO commission_payments (order_id, amount_cents, paid_on, note, created_by) VALUES ($1, $2, $3, $4, $5)', [id, input.amount, input.paid_on, input.note, actor.userId || null]);
      await this.event(tx, id, actor, 'commission_payment', { amount: input.amount, paid_on: input.paid_on });
      await this.notifyParties(tx, actor, o, 'commission_received', { amount: input.amount, paidOn: input.paid_on }, ['producer']);
    });
    return this.get(actor, id);
  }

  async deleteCommissionPayment(actor: Actor, id: string, paymentId: string) {
    this.requireRole(actor, 'admin');
    await withTx(this.deps.db, async (tx) => {
      await this.load(tx, actor, id, true);
      const r = await one<{ amount_cents: number }>(tx, 'DELETE FROM commission_payments WHERE id = $1 AND order_id = $2 RETURNING amount_cents', [paymentId, id]);
      if (!r) throw new AppError('not_found');
      await this.event(tx, id, actor, 'commission_payment_deleted', { amount: r.amount_cents });
    });
    return this.get(actor, id);
  }

  /** Admin: delete an order (only when nothing was paid on it). */
  async remove(actor: Actor, id: string) {
    this.requireRole(actor, 'admin');
    const paid = await one(this.deps.db, 'SELECT 1 FROM order_payments WHERE order_id = $1 UNION ALL SELECT 1 FROM commission_payments WHERE order_id = $1 LIMIT 1', [id]);
    if (paid) throw new AppError('in_use');
    const r = await this.deps.db.query('DELETE FROM orders WHERE id = $1', [id]);
    if (!r.rowCount) throw new AppError('not_found');
  }
}
