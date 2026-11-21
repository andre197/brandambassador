import type { GoodInput } from '@ba/shared';
import { many, one } from '../db/pool.js';
import type { Deps } from '../deps.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../types.js';

const COLS = 'g.id, g.producer_id, g.name_bg, g.name_en, g.sku, g.unit, g.price_cents, g.vat_bp, g.description, g.active, g.created_at, g.updated_at';

export class GoodsService {
  constructor(private readonly deps: Pick<Deps, 'db'>) {}

  /**
   * Producers see their own goods with where each is traded; merchants see a producer's active goods
   * at their price (the agreed one once locked); the admin sees everything.
   */
  async list(actor: Actor, producerId: string | undefined) {
    if (actor.role === 'producer') producerId = actor.producerId!;
    if (!producerId && actor.role !== 'admin') throw new AppError('validation_failed', { fields: { producer_id: 'validation.required' } });

    if (actor.role === 'merchant') {
      return many(
        this.deps.db,
        `SELECT ${COLS}, coalesce(ap.price_cents, g.price_cents) AS my_price_cents, ap.id IS NOT NULL AS price_locked
           FROM goods g JOIN producers p ON p.id = g.producer_id AND p.active
           LEFT JOIN agreed_prices ap ON ap.good_id = g.id AND ap.merchant_id = $2
          WHERE g.producer_id = $1 AND g.active AND NOT g.archived ORDER BY g.name_bg`,
        [producerId, actor.merchantId],
      );
    }
    const where = producerId ? 'g.producer_id = $1 AND NOT g.archived' : 'NOT g.archived';
    return many(
      this.deps.db,
      `SELECT ${COLS}, p.name AS producer_name,
              (SELECT count(*)::int FROM agreed_prices ap WHERE ap.good_id = g.id) AS merchants_count,
              (SELECT coalesce(sum(oi.quantity_milli), 0)::bigint FROM order_items oi JOIN orders o ON o.id = oi.order_id
                 WHERE oi.good_id = g.id AND o.status <> 'cancelled') AS sold_milli
         FROM goods g JOIN producers p ON p.id = g.producer_id
        WHERE ${where} ORDER BY p.name, g.name_bg`,
      producerId ? [producerId] : [],
    );
  }

  private async own(actor: Actor, id: string) {
    const g = await one<{ id: string; producer_id: string }>(this.deps.db, 'SELECT id, producer_id FROM goods WHERE id = $1 AND NOT archived', [id]);
    if (!g || (actor.role === 'producer' && g.producer_id !== actor.producerId)) throw new AppError('not_found');
    if (actor.role === 'merchant') throw new AppError('forbidden');
    return g;
  }

  async create(actor: Actor, producerId: string | undefined, input: GoodInput) {
    const pid = actor.role === 'producer' ? actor.producerId! : producerId;
    if (actor.role === 'merchant') throw new AppError('forbidden');
    if (!pid || !(await one(this.deps.db, 'SELECT 1 FROM producers WHERE id = $1', [pid]))) {
      throw new AppError('validation_failed', { fields: { producer_id: 'validation.required' } });
    }
    const r = await one<{ id: string }>(
      this.deps.db,
      `INSERT INTO goods (producer_id, name_bg, name_en, sku, unit, price_cents, vat_bp, description, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [pid, input.name_bg, input.name_en, input.sku, input.unit, input.price, input.vat_percent, input.description, input.active],
    );
    return { id: r!.id };
  }

  /** Changes the list price only: prices already agreed with merchants stay as they are (only the admin changes those). */
  async update(actor: Actor, id: string, input: GoodInput) {
    await this.own(actor, id);
    await this.deps.db.query(
      `UPDATE goods SET name_bg=$2, name_en=$3, sku=$4, unit=$5, price_cents=$6, vat_bp=$7, description=$8, active=$9, updated_at=now() WHERE id=$1`,
      [id, input.name_bg, input.name_en, input.sku, input.unit, input.price, input.vat_percent, input.description, input.active],
    );
    return { id };
  }

  /** A good that was ever ordered is archived (hidden) instead, so order history keeps it. */
  async remove(actor: Actor, id: string): Promise<{ archived: boolean }> {
    await this.own(actor, id);
    const used = await one(this.deps.db, 'SELECT 1 FROM order_items WHERE good_id = $1 UNION ALL SELECT 1 FROM agreed_prices WHERE good_id = $1 LIMIT 1', [id]);
    if (used) {
      await this.deps.db.query('UPDATE goods SET archived = true, active = false, updated_at = now() WHERE id = $1', [id]);
      return { archived: true };
    }
    await this.deps.db.query('DELETE FROM goods WHERE id = $1', [id]);
    return { archived: false };
  }

  /** Locked prices per merchant: where a producer's goods are traded and at what price. */
  async agreedPrices(actor: Actor, filter: { producerId?: string; merchantId?: string }) {
    if (actor.role === 'producer') filter = { ...filter, producerId: actor.producerId! };
    if (actor.role === 'merchant') filter = { ...filter, merchantId: actor.merchantId! };
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.producerId) where.push(`g.producer_id = $${params.push(filter.producerId)}`);
    if (filter.merchantId) where.push(`ap.merchant_id = $${params.push(filter.merchantId)}`);
    return many(
      this.deps.db,
      `SELECT ap.id, ap.good_id, ap.merchant_id, ap.price_cents, ap.updated_at, g.name_bg, g.name_en, g.unit, g.price_cents AS list_price_cents,
              g.vat_bp, g.producer_id, p.name AS producer_name, m.name AS merchant_name,
              (SELECT coalesce(sum(oi.quantity_milli), 0)::bigint FROM order_items oi JOIN orders o ON o.id = oi.order_id
                 WHERE oi.good_id = g.id AND o.merchant_id = ap.merchant_id AND o.status <> 'cancelled') AS quantity_milli,
              (SELECT max(o.order_date) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                 WHERE oi.good_id = g.id AND o.merchant_id = ap.merchant_id AND o.status <> 'cancelled') AS last_order_on
         FROM agreed_prices ap JOIN goods g ON g.id = ap.good_id JOIN producers p ON p.id = g.producer_id JOIN merchants m ON m.id = ap.merchant_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY m.name, g.name_bg`,
      params,
    );
  }
}
