import { addDays, concealmentPenaltyCents, type OrderCalc, reportQuerySchema, sofiaToday, terminationPenaltyCents } from '@ba/shared';
import type { z } from 'zod';
import { many, one } from '../db/pool.js';
import type { Deps } from '../deps.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../types.js';
import type { NotificationService } from './notification.service.js';
import type { OrderRow, OrderService } from './order.service.js';
import { contractTerm } from './party.service.js';

const sumBy = (calcs: OrderCalc[], k: keyof OrderCalc) => calcs.reduce((s, c) => s + (c[k] as number), 0);

function commissionTotals(calcs: OrderCalc[]) {
  return {
    orders: calcs.length,
    netCents: sumBy(calcs, 'baseNetCents'),
    grossCents: sumBy(calcs, 'payableGrossCents'),
    paidCents: sumBy(calcs, 'paidCents'),
    commissionCents: sumBy(calcs, 'commissionCents'),
    accruedCents: sumBy(calcs, 'commissionAccruedCents'),
    receivedCents: sumBy(calcs, 'commissionReceivedCents'),
    outstandingCents: sumBy(calcs, 'commissionOutstandingCents'),
    overdueCents: sumBy(calcs, 'commissionOverdueCents'),
  };
}

export class ReportService {
  constructor(
    private readonly deps: Pick<Deps, 'db' | 'now'>,
    private readonly orders: OrderService,
    private readonly notifications: NotificationService,
  ) {}

  private today() {
    return sofiaToday(this.deps.now());
  }

  private async scopedOrders(actor: Actor, q: { from?: string | null; to?: string | null; producer_id?: string; merchant_id?: string } = {}) {
    const params: unknown[] = [];
    const where = [`o.status <> 'cancelled'`];
    if (actor.role === 'producer') where.push(`o.producer_id = $${params.push(actor.producerId)}`);
    if (actor.role === 'merchant') where.push(`o.merchant_id = $${params.push(actor.merchantId)}`);
    if (q.producer_id) where.push(`o.producer_id = $${params.push(q.producer_id)}`);
    if (q.merchant_id) where.push(`o.merchant_id = $${params.push(q.merchant_id)}`);
    if (q.from) where.push(`o.order_date >= $${params.push(q.from)}`);
    if (q.to) where.push(`o.order_date <= $${params.push(q.to)}`);
    const rows = await many<OrderRow>(
      this.deps.db,
      `SELECT o.*, p.name AS producer_name, m.name AS merchant_name FROM orders o JOIN producers p ON p.id = o.producer_id JOIN merchants m ON m.id = o.merchant_id
        WHERE ${where.join(' AND ')} ORDER BY o.order_date DESC, o.number DESC`,
      params,
    );
    const calcs = await this.orders.calcFor(this.deps.db, rows);
    return rows.map((r) => ({ row: r, calc: calcs.get(r.id)! }));
  }

  async dashboard(actor: Actor) {
    const today = this.today();
    const unread = await this.notifications.unread(actor);
    if (actor.role === 'merchant') {
      const recent = await this.orders.list(actor, { q: '', status: undefined, producer_id: undefined, merchant_id: undefined, from: null, to: null });
      const reminders = await many(
        this.deps.db,
        `SELECT r.id, r.due_on, r.message, p.name AS producer_name, r.producer_id FROM reminders r LEFT JOIN producers p ON p.id = r.producer_id
          WHERE r.merchant_id = $1 AND r.status = 'open' ORDER BY r.due_on LIMIT 20`,
        [actor.merchantId],
      );
      const pending = (await one<{ n: number }>(this.deps.db, `SELECT count(*)::int AS n FROM price_requests WHERE merchant_id = $1 AND status = 'pending'`, [actor.merchantId]))!.n;
      return {
        unread,
        reminders,
        pendingRequests: pending,
        openOrders: recent.filter((o) => o.status === 'new' || o.status === 'confirmed').length,
        recent: recent.slice(0, 10),
      };
    }

    const all = await this.scopedOrders(actor);
    const calcs = all.map((a) => a.calc);
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const monthStart = `${today.slice(0, 7)}-01`;
    const params: unknown[] = [];
    const scope = actor.role === 'producer' ? `AND o.producer_id = $${params.push(actor.producerId)}` : '';
    const received = await one<{ month: number; year: number }>(
      this.deps.db,
      `SELECT coalesce(sum(cp.amount_cents) FILTER (WHERE cp.paid_on >= $${params.push(monthStart)}), 0)::bigint AS month,
              coalesce(sum(cp.amount_cents) FILTER (WHERE cp.paid_on >= $${params.push(yearStart)}), 0)::bigint AS year
         FROM commission_payments cp JOIN orders o ON o.id = cp.order_id WHERE true ${scope}`,
      params,
    );
    const listRow = (a: (typeof all)[number]) => ({ ...a.row, calc: a.calc });
    const overdue = all.filter((a) => a.calc.commissionOverdueCents > 0).map(listRow).slice(0, 15);
    const due = all
      .filter((a) => a.calc.commissionOutstandingCents > 0 && a.calc.commissionOverdueCents === 0)
      .sort((a, b) => (a.calc.commissionNextDueOn ?? '').localeCompare(b.calc.commissionNextDueOn ?? ''))
      .map(listRow)
      .slice(0, 15);
    const yearCalcs = all.filter((a) => a.row.order_date >= yearStart).map((a) => a.calc);
    const base = {
      unread,
      totals: commissionTotals(calcs),
      year: commissionTotals(yearCalcs),
      receivedMonthCents: received!.month,
      receivedYearCents: received!.year,
      newOrders: all.filter((a) => a.row.status === 'new').length,
      recent: all.slice(0, 10).map(listRow),
      overdue,
      due,
    };

    if (actor.role === 'producer') {
      const pending = (await one<{ n: number }>(this.deps.db, `SELECT count(*)::int AS n FROM price_requests WHERE producer_id = $1 AND status = 'pending'`, [actor.producerId]))!.n;
      return { ...base, pendingRequests: pending };
    }

    const pending = (await one<{ n: number }>(this.deps.db, `SELECT count(*)::int AS n FROM price_requests WHERE status = 'pending'`))!.n;
    const reminders = await many(
      this.deps.db,
      `SELECT r.id, r.due_on, m.name AS merchant_name, p.name AS producer_name FROM reminders r JOIN merchants m ON m.id = r.merchant_id
         LEFT JOIN producers p ON p.id = r.producer_id WHERE r.status = 'open' AND r.due_on <= $1 ORDER BY r.due_on LIMIT 20`,
      [addDays(today, 14)],
    );
    const producers = await many<{ id: string; name: string; contract_signed_on: string | null }>(this.deps.db, 'SELECT id, name, contract_signed_on FROM producers WHERE active AND contract_signed_on IS NOT NULL');
    const contracts = producers
      .map((p) => ({ id: p.id, name: p.name, ...contractTerm(p.contract_signed_on, today)! }))
      .filter((c) => c.notice <= addDays(today, 45))
      .sort((a, b) => a.notice.localeCompare(b.notice));
    return { ...base, pendingRequests: pending, reminders, contracts };
  }

  /** Per order: the commission, what accrued, what I received and what is still owed. */
  async commissions(actor: Actor, q: z.output<typeof reportQuerySchema>) {
    if (actor.role === 'merchant') throw new AppError('forbidden');
    const all = await this.scopedOrders(actor, q);
    const rows = all.map(({ row, calc }) => ({
      id: row.id,
      number: row.number,
      order_date: row.order_date,
      status: row.status,
      producer_id: row.producer_id,
      producer_name: row.producer_name,
      merchant_id: row.merchant_id,
      merchant_name: row.merchant_name,
      calc,
    }));
    const byProducer = new Map<string, { producer_id: string; producer_name: string; calcs: OrderCalc[] }>();
    for (const r of rows) {
      const g = byProducer.get(r.producer_id) ?? { producer_id: r.producer_id, producer_name: r.producer_name, calcs: [] };
      g.calcs.push(r.calc);
      byProducer.set(r.producer_id, g);
    }
    const params: unknown[] = [];
    const where: string[] = [];
    if (actor.role === 'producer') where.push(`o.producer_id = $${params.push(actor.producerId)}`);
    if (q.producer_id) where.push(`o.producer_id = $${params.push(q.producer_id)}`);
    if (q.merchant_id) where.push(`o.merchant_id = $${params.push(q.merchant_id)}`);
    if (q.from) where.push(`cp.paid_on >= $${params.push(q.from)}`);
    if (q.to) where.push(`cp.paid_on <= $${params.push(q.to)}`);
    const payments = await many(
      this.deps.db,
      `SELECT cp.id, cp.amount_cents, cp.paid_on, cp.note, o.id AS order_id, o.number, p.name AS producer_name, m.name AS merchant_name
         FROM commission_payments cp JOIN orders o ON o.id = cp.order_id JOIN producers p ON p.id = o.producer_id JOIN merchants m ON m.id = o.merchant_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY cp.paid_on DESC, cp.created_at DESC`,
      params,
    );
    return {
      rows,
      totals: commissionTotals(rows.map((r) => r.calc)),
      producers: [...byProducer.values()].map((g) => ({ producer_id: g.producer_id, producer_name: g.producer_name, ...commissionTotals(g.calcs) })).sort((a, b) => b.commissionCents - a.commissionCents),
      payments,
    };
  }

  /** Where a producer's goods are traded, at what price, how much; plus the contract figures per buyer. */
  async trade(actor: Actor, producerId: string | undefined) {
    if (actor.role === 'merchant') throw new AppError('forbidden');
    const pid = actor.role === 'producer' ? actor.producerId! : producerId;
    if (!pid) throw new AppError('validation_failed', { fields: { producer_id: 'validation.required' } });
    const today = this.today();
    const lines = await many<{
      merchant_id: string;
      merchant_name: string;
      merchant_address: string;
      good_id: string | null;
      name_bg: string;
      name_en: string | null;
      unit: string;
      quantity_milli: number;
      net_cents: number;
      orders: number;
      last_order_on: string;
      last_price_cents: number;
      agreed_price_cents: number | null;
      last_price_gross_cents: number;
      agreed_price_gross_cents: number | null;
      gross_cents: number;
    }>(
      this.deps.db,
      `SELECT o.merchant_id, m.name AS merchant_name, m.address AS merchant_address, oi.good_id, max(oi.name_bg) AS name_bg, max(oi.name_en) AS name_en, max(oi.unit) AS unit,
              sum(oi.quantity_milli)::bigint AS quantity_milli, sum(oi.line_net_cents)::bigint AS net_cents, sum(oi.line_gross_cents)::bigint AS gross_cents,
              count(DISTINCT o.id)::int AS orders, max(o.order_date) AS last_order_on,
              (array_agg(oi.unit_price_cents ORDER BY o.order_date DESC, o.number DESC))[1] AS last_price_cents,
              (array_agg(oi.unit_price_gross_cents ORDER BY o.order_date DESC, o.number DESC))[1] AS last_price_gross_cents,
              (SELECT ap.price_cents FROM agreed_prices ap WHERE ap.good_id = oi.good_id AND ap.merchant_id = o.merchant_id) AS agreed_price_cents,
              (SELECT ap.price_gross_cents FROM agreed_prices ap WHERE ap.good_id = oi.good_id AND ap.merchant_id = o.merchant_id) AS agreed_price_gross_cents
         FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN merchants m ON m.id = o.merchant_id
        WHERE o.producer_id = $1 AND o.status <> 'cancelled'
        GROUP BY o.merchant_id, m.name, m.address, oi.good_id ORDER BY m.name, name_bg`,
      [pid],
    );
    const pairs = await many<{ merchant_id: string; status: string; active_period_days: number }>(this.deps.db, 'SELECT merchant_id, status, active_period_days FROM producer_merchants WHERE producer_id = $1', [pid]);
    const pairBy = new Map(pairs.map((p) => [p.merchant_id, p]));
    const merchants = new Map<string, { merchant_id: string; merchant_name: string; merchant_address: string; net_cents: number; gross_cents: number; last_order_on: string; lines: typeof lines }>();
    for (const l of lines) {
      const m = merchants.get(l.merchant_id) ?? { merchant_id: l.merchant_id, merchant_name: l.merchant_name, merchant_address: l.merchant_address, net_cents: 0, gross_cents: 0, last_order_on: l.last_order_on, lines: [] };
      m.net_cents += l.net_cents;
      m.gross_cents += l.gross_cents;
      if (l.last_order_on > m.last_order_on) m.last_order_on = l.last_order_on;
      m.lines.push(l);
      merchants.set(l.merchant_id, m);
    }
    const out = [...merchants.values()].map((m) => {
      const pair = pairBy.get(m.merchant_id);
      const active = addDays(m.last_order_on, pair?.active_period_days ?? 30) >= today;
      return { ...m, pair_status: pair?.status ?? 'attracted', active_buyer: active, termination_penalty_cents: active && pair?.status === 'attracted' ? terminationPenaltyCents(m.net_cents) : 0 };
    });
    const last12 = await one<{ n: number }>(
      this.deps.db,
      `SELECT coalesce(sum(net_cents - returned_net_cents), 0)::bigint AS n FROM orders WHERE producer_id = $1 AND status <> 'cancelled' AND order_date > $2`,
      [pid, addDays(today, -365)],
    );
    return {
      merchants: out,
      totals: {
        netCents: out.reduce((s, m) => s + m.net_cents, 0),
        activeBuyers: out.filter((m) => m.active_buyer).length,
        last12MonthsNetCents: last12!.n,
        terminationPenaltyCents: out.reduce((s, m) => s + m.termination_penalty_cents, 0),
        concealmentPenaltyCents: concealmentPenaltyCents(last12!.n),
      },
    };
  }
}
