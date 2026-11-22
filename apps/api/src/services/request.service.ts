import { agreedPriceSchema, priceRequestSchema, type RequestStatus, resolveRequestSchema } from '@ba/shared';
import type { z } from 'zod';
import { many, one, type Queryable, withTx } from '../db/pool.js';
import type { Deps } from '../deps.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../types.js';
import type { NotificationService } from './notification.service.js';
import type { OrderService } from './order.service.js';

const SELECT = `SELECT r.*, g.name_bg AS good_name, g.name_en AS good_name_en, g.unit, p.name AS producer_name, m.name AS merchant_name, o.number AS order_number,
       u.email AS requested_by_email
  FROM price_requests r JOIN goods g ON g.id = r.good_id JOIN producers p ON p.id = r.producer_id LEFT JOIN merchants m ON m.id = r.merchant_id
  LEFT JOIN orders o ON o.id = r.order_id LEFT JOIN users u ON u.id = r.requested_by`;

/**
 * Prices in use can only be changed by the admin. Producers and merchants ask for a change here
 * (with an optional description); the admin approves with a new price, or rejects.
 * - With a merchant: that merchant's agreed price (the price of its orders).
 * - Without a merchant (producers only): the good's own price, for merchants that have not ordered it yet.
 *   Approving it changes nothing else: agreed prices and existing orders stay as they are.
 */
export class RequestService {
  constructor(
    private readonly deps: Pick<Deps, 'db'>,
    private readonly notifications: NotificationService,
    private readonly orders: OrderService,
  ) {}

  async list(actor: Actor, status?: RequestStatus) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (actor.role === 'producer') where.push(`r.producer_id = $${params.push(actor.producerId)}`);
    if (actor.role === 'merchant') where.push(`r.merchant_id = $${params.push(actor.merchantId)}`);
    if (status) where.push(`r.status = $${params.push(status)}`);
    return many(this.deps.db, `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT 300`, params);
  }

  async create(actor: Actor, input: z.output<typeof priceRequestSchema>) {
    if (actor.role === 'admin') throw new AppError('forbidden');
    const good = await one<{ id: string; producer_id: string; name_bg: string; price_cents: number }>(this.deps.db, 'SELECT id, producer_id, name_bg, price_cents FROM goods WHERE id = $1 AND NOT archived', [input.good_id]);
    if (!good || (actor.role === 'producer' && good.producer_id !== actor.producerId)) throw new AppError('not_found');
    // A producer without a merchant asks for the good's own price.
    const merchantId = actor.role === 'merchant' ? actor.merchantId! : (input.merchant_id ?? null);
    if (!merchantId && input.order_id) throw new AppError('validation_failed', { fields: { merchant_id: 'validation.required' } });
    if (!merchantId && input.proposed_price === null) throw new AppError('validation_failed', { fields: { proposed_price: 'validation.price_required' } });
    if (input.order_id) {
      const o = await one<{ producer_id: string; merchant_id: string }>(this.deps.db, 'SELECT producer_id, merchant_id FROM orders WHERE id = $1', [input.order_id]);
      if (!o || o.producer_id !== good.producer_id || o.merchant_id !== merchantId) throw new AppError('not_found');
    }
    const names = await one<{ producer: string; merchant: string | null }>(
      this.deps.db,
      'SELECT p.name AS producer, m.name AS merchant FROM producers p LEFT JOIN merchants m ON m.id = $2 WHERE p.id = $1',
      [good.producer_id, merchantId],
    );
    if (!names || (merchantId && !names.merchant)) throw new AppError('not_found');
    const agreed = merchantId ? await one<{ price_cents: number }>(this.deps.db, 'SELECT price_cents FROM agreed_prices WHERE good_id = $1 AND merchant_id = $2', [good.id, merchantId]) : null;
    const current = agreed?.price_cents ?? good.price_cents;

    return withTx(this.deps.db, async (tx) => {
      const r = await one<{ id: string; number: number }>(
        tx,
        `INSERT INTO price_requests (good_id, producer_id, merchant_id, order_id, requested_by, requested_by_role, current_price_cents, proposed_price_cents, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, number`,
        [good.id, good.producer_id, merchantId, input.order_id ?? null, actor.userId, actor.role, current, input.proposed_price, input.description],
      );
      await this.notifications.notify(
        tx,
        { audience: 'admin' },
        'request_created',
        {
          number: r!.number,
          good: good.name_bg,
          producer: names.producer,
          merchant: names.merchant ?? '',
          kind: merchantId ? 'agreed' : 'list',
          current,
          proposed: input.proposed_price,
          description: input.description,
          by: actor.role,
        },
        '/requests',
      );
      return r!;
    });
  }

  /** Sets the agreed price of a good for a merchant, optionally on that pair's undelivered orders too. */
  private async applyPrice(tx: Queryable, goodId: string, merchantId: string, price: number, applyToOpen: boolean): Promise<number[]> {
    await tx.query(
      `INSERT INTO agreed_prices (good_id, merchant_id, price_cents) VALUES ($1, $2, $3)
       ON CONFLICT (good_id, merchant_id) DO UPDATE SET price_cents = EXCLUDED.price_cents, updated_at = now()`,
      [goodId, merchantId, price],
    );
    if (!applyToOpen) return [];
    const changed = await many<{ order_id: string; number: number }>(
      tx,
      `UPDATE order_items oi SET unit_price_cents = $3 FROM orders o
        WHERE o.id = oi.order_id AND oi.good_id = $1 AND o.merchant_id = $2 AND o.status IN ('new', 'confirmed') AND oi.unit_price_cents <> $3
        RETURNING oi.order_id, o.number`,
      [goodId, merchantId, price],
    );
    const ids = [...new Set(changed.map((c) => c.order_id))];
    for (const id of ids) await this.orders.recompute(tx, id);
    return [...new Set(changed.map((c) => c.number))];
  }

  async resolve(actor: Actor, id: string, input: z.output<typeof resolveRequestSchema>) {
    if (actor.role !== 'admin') throw new AppError('forbidden');
    await withTx(this.deps.db, async (tx) => {
      const r = await one<{ id: string; number: number; status: string; good_id: string; producer_id: string; merchant_id: string | null; good_name: string; order_id: string | null }>(
        tx,
        `SELECT r.id, r.number, r.status, r.good_id, r.producer_id, r.merchant_id, r.order_id, g.name_bg AS good_name FROM price_requests r JOIN goods g ON g.id = r.good_id WHERE r.id = $1 FOR UPDATE OF r`,
        [id],
      );
      if (!r) throw new AppError('not_found');
      if (r.status !== 'pending') throw new AppError('invalid_state');
      let orders: number[] = [];
      if (input.decision === 'approved') {
        if (r.merchant_id) orders = await this.applyPrice(tx, r.good_id, r.merchant_id, input.new_price!, input.apply_to_open_orders);
        // The good's own price: nothing else changes (agreed prices and orders keep theirs).
        else await tx.query('UPDATE goods SET price_cents = $2, updated_at = now() WHERE id = $1', [r.good_id, input.new_price]);
      }
      await tx.query(`UPDATE price_requests SET status = $2, new_price_cents = $3, response = $4, resolved_by = $5, resolved_at = now() WHERE id = $1`, [
        id,
        input.decision,
        input.decision === 'approved' ? input.new_price : null,
        input.response,
        actor.userId || null,
      ]);
      const data = { number: r.number, good: r.good_name, decision: input.decision, price: input.new_price, response: input.response, orders };
      await this.notifications.notify(tx, { audience: 'producer', producerId: r.producer_id }, 'request_resolved', data, '/requests');
      if (r.merchant_id) await this.notifications.notify(tx, { audience: 'merchant', merchantId: r.merchant_id }, 'request_resolved', data, '/requests');
    });
    return one(this.deps.db, `${SELECT} WHERE r.id = $1`, [id]);
  }

  /** Admin: change an agreed price directly. */
  async setAgreedPrice(actor: Actor, goodId: string, merchantId: string, input: z.output<typeof agreedPriceSchema>) {
    if (actor.role !== 'admin') throw new AppError('forbidden');
    const ok = await one(this.deps.db, 'SELECT 1 FROM goods g, merchants m WHERE g.id = $1 AND m.id = $2', [goodId, merchantId]);
    if (!ok) throw new AppError('not_found');
    const orders = await withTx(this.deps.db, (tx) => this.applyPrice(tx, goodId, merchantId, input.price, input.apply_to_open_orders));
    return { ok: true, orders };
  }

  async deleteAgreedPrice(actor: Actor, goodId: string, merchantId: string) {
    if (actor.role !== 'admin') throw new AppError('forbidden');
    await this.deps.db.query('DELETE FROM agreed_prices WHERE good_id = $1 AND merchant_id = $2', [goodId, merchantId]);
  }
}
