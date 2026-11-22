import {
  addDays,
  addMonths,
  CONTRACT,
  type CommissionType,
  type MerchantInput,
  type PairInput,
  type ProducerInput,
  type ShopInput,
  merchantProfileSchema,
  producerProfileSchema,
  sofiaToday,
} from '@ba/shared';
import { parse } from '../lib/validate.js';
import { many, one } from '../db/pool.js';
import type { Deps } from '../deps.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../types.js';
import type { SettingsService } from './settings.service.js';

/** The current one-year term of a contract and its renewal notice deadline (art. 19). */
export function contractTerm(signedOn: string | null, today: string): { end: string; notice: string } | null {
  if (!signedOn) return null;
  let end = addMonths(signedOn, CONTRACT.termMonths);
  for (let i = 0; end < today && i < 100; i++) end = addMonths(end, CONTRACT.termMonths);
  return { end, notice: addDays(end, -CONTRACT.noticeDays) };
}

const PRODUCER_COLS = `p.id, p.name, p.eik, p.phone, p.email, p.address, p.contact_person, p.active,
  p.delivery_method, p.delivery_note, p.invoice_method, p.invoice_note, p.default_vat_bp`;
const PRODUCER_ADMIN_COLS = `${PRODUCER_COLS}, p.notes, p.commission_type, p.commission_bp, p.commission_unit_cents, p.contract_number, p.contract_signed_on, p.created_at, p.updated_at`;
const MERCHANT_COLS = `m.id, m.name, m.eik, m.phone, m.email, m.address, m.contact_person, m.active,
  m.invoice_method, m.invoice_email, m.invoice_note, m.delivery_note`;
const MERCHANT_ADMIN_COLS = `${MERCHANT_COLS}, m.notes, m.created_at, m.updated_at`;

/** Order money per party, cancelled orders excluded. */
const STATS = (col: 'producer_id' | 'merchant_id') => `(
  SELECT json_build_object(
    'orders', count(*)::int,
    'net_cents', coalesce(sum(o.net_cents - o.returned_net_cents), 0)::bigint,
    'commission_cents', coalesce(sum(o.commission_cents), 0)::bigint,
    'received_cents', coalesce((SELECT sum(cp.amount_cents) FROM commission_payments cp JOIN orders o2 ON o2.id = cp.order_id WHERE o2.${col} = x.id AND o2.status <> 'cancelled'), 0)::bigint,
    'last_order_on', max(o.order_date)
  ) FROM orders o WHERE o.${col} = x.id AND o.status <> 'cancelled')`;

export class PartyService {
  constructor(
    private readonly deps: Pick<Deps, 'db' | 'now'>,
    private readonly settings: SettingsService,
  ) {}

  private today() {
    return sofiaToday(this.deps.now());
  }

  // ─── Producers ───

  async listProducers(actor: Actor) {
    if (actor.role === 'admin') {
      const rows = await many<Record<string, unknown> & { contract_signed_on: string | null }>(
        this.deps.db,
        `SELECT ${PRODUCER_ADMIN_COLS},
                (SELECT count(*)::int FROM goods g WHERE g.producer_id = p.id AND NOT g.archived) AS goods_count,
                (SELECT count(*)::int FROM producer_merchants pm WHERE pm.producer_id = p.id) AS merchants_count,
                (SELECT count(*)::int FROM users u WHERE u.producer_id = p.id) AS users_count,
                ${STATS('producer_id').replaceAll('x.id', 'p.id')} AS stats
           FROM producers p ORDER BY p.name`,
      );
      const today = this.today();
      return rows.map((r) => ({ ...r, contract: contractTerm(r.contract_signed_on, today) }));
    }
    if (actor.role === 'merchant') {
      return many(
        this.deps.db,
        `SELECT ${PRODUCER_COLS},
                (SELECT count(*)::int FROM goods g WHERE g.producer_id = p.id AND g.active AND NOT g.archived) AS goods_count,
                (SELECT count(*)::int FROM orders o WHERE o.producer_id = p.id AND o.merchant_id = $1 AND o.status <> 'cancelled') AS my_orders,
                (SELECT max(o.order_date) FROM orders o WHERE o.producer_id = p.id AND o.merchant_id = $1 AND o.status <> 'cancelled') AS my_last_order_on
           FROM producers p WHERE p.active ORDER BY p.name`,
        [actor.merchantId],
      );
    }
    return many(this.deps.db, `SELECT ${PRODUCER_COLS} FROM producers p WHERE p.id = $1`, [actor.producerId]);
  }

  async producer(actor: Actor, id: string) {
    if (actor.role === 'producer' && id !== actor.producerId) throw new AppError('not_found');
    if (actor.role === 'admin' || actor.role === 'producer') {
      const p = await one<Record<string, unknown> & { contract_signed_on: string | null }>(
        this.deps.db,
        `SELECT ${PRODUCER_ADMIN_COLS}, ${STATS('producer_id').replaceAll('x.id', 'p.id')} AS stats FROM producers p WHERE p.id = $1`,
        [id],
      );
      if (!p) throw new AppError('not_found');
      const out = { ...p, contract: contractTerm(p.contract_signed_on, this.today()) };
      if (actor.role === 'producer') delete (out as Record<string, unknown>).notes;
      return out;
    }
    const p = await one(this.deps.db, `SELECT ${PRODUCER_COLS} FROM producers p WHERE p.id = $1 AND p.active`, [id]);
    if (!p) throw new AppError('not_found');
    return p;
  }

  async saveProducer(id: string | null, input: ProducerInput) {
    const dup = await one(this.deps.db, 'SELECT 1 FROM producers WHERE eik = $1 AND id IS DISTINCT FROM $2', [input.eik, id]);
    if (dup) throw new AppError('eik_taken', { fields: { eik: 'validation.eik_taken' } });
    const commission = input.commission_percent ?? (await this.settings.get()).default_commission_bp;
    const values = [
      input.name,
      input.eik,
      input.phone,
      input.email,
      input.address,
      input.contact_person,
      input.notes,
      input.active,
      commission,
      input.default_vat_percent,
      input.delivery_method,
      input.delivery_note,
      input.invoice_method,
      input.invoice_note,
      input.contract_number,
      input.contract_signed_on,
      input.commission_type,
      input.commission_type === 'per_unit' ? (input.commission_unit ?? 0) : 0,
    ];
    if (id) {
      const r = await one<{ id: string }>(
        this.deps.db,
        `UPDATE producers SET name=$1, eik=$2, phone=$3, email=$4, address=$5, contact_person=$6, notes=$7, active=$8, commission_bp=$9,
                default_vat_bp=$10, delivery_method=$11, delivery_note=$12, invoice_method=$13, invoice_note=$14, contract_number=$15,
                contract_signed_on=$16, commission_type=$17, commission_unit_cents=$18, updated_at=now() WHERE id=$19 RETURNING id`,
        [...values, id],
      );
      if (!r) throw new AppError('not_found');
      return { id };
    }
    const r = await one<{ id: string }>(
      this.deps.db,
      `INSERT INTO producers (name, eik, phone, email, address, contact_person, notes, active, commission_bp, default_vat_bp, delivery_method,
              delivery_note, invoice_method, invoice_note, contract_number, contract_signed_on, commission_type, commission_unit_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      values,
    );
    return { id: r!.id };
  }

  async deleteProducer(id: string) {
    const used = await one(this.deps.db, 'SELECT 1 FROM orders WHERE producer_id = $1 LIMIT 1', [id]);
    if (used) throw new AppError('in_use');
    const r = await this.deps.db.query('DELETE FROM producers WHERE id = $1', [id]);
    if (!r.rowCount) throw new AppError('not_found');
  }

  // ─── Merchants ───

  async listMerchants(actor: Actor) {
    if (actor.role === 'admin') {
      return many(
        this.deps.db,
        `SELECT ${MERCHANT_ADMIN_COLS},
                (SELECT count(*)::int FROM producer_merchants pm WHERE pm.merchant_id = m.id) AS producers_count,
                (SELECT count(*)::int FROM users u WHERE u.merchant_id = m.id) AS users_count,
                (SELECT count(*)::int FROM reminders r WHERE r.merchant_id = m.id AND r.status = 'open') AS open_reminders,
                ${STATS('merchant_id').replaceAll('x.id', 'm.id')} AS stats
           FROM merchants m ORDER BY m.name`,
      );
    }
    if (actor.role === 'producer') {
      // Where the producer's goods are traded: merchants it has a relationship or orders with.
      return many(
        this.deps.db,
        `SELECT ${MERCHANT_COLS}, pm.status AS pair_status, pm.active_period_days,
                (SELECT count(*)::int FROM orders o WHERE o.merchant_id = m.id AND o.producer_id = $1 AND o.status <> 'cancelled') AS orders,
                (SELECT coalesce(sum(o.net_cents - o.returned_net_cents), 0)::bigint FROM orders o WHERE o.merchant_id = m.id AND o.producer_id = $1 AND o.status <> 'cancelled') AS net_cents,
                (SELECT max(o.order_date) FROM orders o WHERE o.merchant_id = m.id AND o.producer_id = $1 AND o.status <> 'cancelled') AS last_order_on
           FROM producer_merchants pm JOIN merchants m ON m.id = pm.merchant_id
          WHERE pm.producer_id = $1 ORDER BY m.name`,
        [actor.producerId],
      );
    }
    return many(this.deps.db, `SELECT ${MERCHANT_COLS} FROM merchants m WHERE m.id = $1`, [actor.merchantId]);
  }

  async merchant(actor: Actor, id: string) {
    if (actor.role === 'merchant' && id !== actor.merchantId) throw new AppError('not_found');
    if (actor.role === 'producer') {
      const m = await one(
        this.deps.db,
        `SELECT ${MERCHANT_COLS} FROM merchants m WHERE m.id = $1 AND EXISTS (SELECT 1 FROM producer_merchants pm WHERE pm.merchant_id = m.id AND pm.producer_id = $2)`,
        [id, actor.producerId],
      );
      if (!m) throw new AppError('not_found');
      return m;
    }
    // The commission is between the producer and me: merchants never see it.
    const cols = actor.role === 'admin' ? `${MERCHANT_ADMIN_COLS}, ${STATS('merchant_id').replaceAll('x.id', 'm.id')} AS stats` : MERCHANT_COLS;
    const m = await one(this.deps.db, `SELECT ${cols} FROM merchants m WHERE m.id = $1`, [id]);
    if (!m) throw new AppError('not_found');
    return m;
  }

  async saveMerchant(id: string | null, input: MerchantInput) {
    const dup = await one(this.deps.db, 'SELECT 1 FROM merchants WHERE eik = $1 AND id IS DISTINCT FROM $2', [input.eik, id]);
    if (dup) throw new AppError('eik_taken', { fields: { eik: 'validation.eik_taken' } });
    const values = [input.name, input.eik, input.phone, input.email, input.address, input.contact_person, input.notes, input.active, input.invoice_method, input.invoice_email, input.invoice_note, input.delivery_note];
    if (id) {
      const r = await one<{ id: string }>(
        this.deps.db,
        `UPDATE merchants SET name=$1, eik=$2, phone=$3, email=$4, address=$5, contact_person=$6, notes=$7, active=$8, invoice_method=$9,
                invoice_email=$10, invoice_note=$11, delivery_note=$12, updated_at=now() WHERE id=$13 RETURNING id`,
        [...values, id],
      );
      if (!r) throw new AppError('not_found');
      return { id };
    }
    const r = await one<{ id: string }>(
      this.deps.db,
      `INSERT INTO merchants (name, eik, phone, email, address, contact_person, notes, active, invoice_method, invoice_email, invoice_note, delivery_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      values,
    );
    return { id: r!.id };
  }

  async deleteMerchant(id: string) {
    const used = await one(this.deps.db, 'SELECT 1 FROM orders WHERE merchant_id = $1 LIMIT 1', [id]);
    if (used) throw new AppError('in_use');
    const r = await this.deps.db.query('DELETE FROM merchants WHERE id = $1', [id]);
    if (!r.rowCount) throw new AppError('not_found');
  }

  // ─── Shops of a merchant ───

  /** The admin and the merchant see all its shops; producers see the active shops (to record orders). */
  async shops(actor: Actor, merchantId: string) {
    if (actor.role === 'merchant' && merchantId !== actor.merchantId) throw new AppError('not_found');
    const onlyActive = actor.role === 'producer';
    return many(
      this.deps.db,
      `SELECT s.id, s.merchant_id, s.alias, s.address, s.active, s.created_at, s.updated_at,
              (SELECT count(DISTINCT oi.order_id)::int FROM order_items oi WHERE oi.shop_id = s.id) AS orders
         FROM merchant_shops s WHERE s.merchant_id = $1${onlyActive ? ' AND s.active' : ''} ORDER BY s.alias`,
      [merchantId],
    );
  }

  async saveShop(merchantId: string, shopId: string | null, input: ShopInput) {
    const m = await one(this.deps.db, 'SELECT 1 FROM merchants WHERE id = $1', [merchantId]);
    if (!m) throw new AppError('not_found');
    const dup = await one(this.deps.db, 'SELECT 1 FROM merchant_shops WHERE merchant_id = $1 AND lower(alias) = lower($2) AND id IS DISTINCT FROM $3', [merchantId, input.alias, shopId]);
    if (dup) throw new AppError('validation_failed', { fields: { alias: 'validation.alias_taken' } });
    if (shopId) {
      const r = await one<{ id: string }>(
        this.deps.db,
        'UPDATE merchant_shops SET alias = $3, address = $4, active = $5, updated_at = now() WHERE id = $1 AND merchant_id = $2 RETURNING id',
        [shopId, merchantId, input.alias, input.address, input.active],
      );
      if (!r) throw new AppError('not_found');
      return { id: shopId };
    }
    const r = await one<{ id: string }>(this.deps.db, 'INSERT INTO merchant_shops (merchant_id, alias, address, active) VALUES ($1, $2, $3, $4) RETURNING id', [
      merchantId,
      input.alias,
      input.address,
      input.active,
    ]);
    return { id: r!.id };
  }

  /** Orders keep the shop's alias and address, so a shop can be deleted even if it has orders. */
  async deleteShop(merchantId: string, shopId: string) {
    const r = await this.deps.db.query('DELETE FROM merchant_shops WHERE id = $1 AND merchant_id = $2', [shopId, merchantId]);
    if (!r.rowCount) throw new AppError('not_found');
  }

  // ─── Own profile ───

  async updateOwnProfile(actor: Actor, body: unknown) {
    if (actor.role === 'producer') {
      const i = parse(producerProfileSchema, body);
      await this.deps.db.query(
        `UPDATE producers SET phone=$2, address=$3, contact_person=$4, delivery_method=$5, delivery_note=$6, invoice_method=$7, invoice_note=$8,
                default_vat_bp=$9, updated_at=now() WHERE id=$1`,
        [actor.producerId, i.phone, i.address, i.contact_person, i.delivery_method, i.delivery_note, i.invoice_method, i.invoice_note, i.default_vat_percent],
      );
      return this.producer(actor, actor.producerId!);
    }
    if (actor.role === 'merchant') {
      const i = parse(merchantProfileSchema, body);
      await this.deps.db.query(
        `UPDATE merchants SET phone=$2, address=$3, contact_person=$4, invoice_method=$5, invoice_email=$6, invoice_note=$7, delivery_note=$8, updated_at=now() WHERE id=$1`,
        [actor.merchantId, i.phone, i.address, i.contact_person, i.invoice_method, i.invoice_email, i.invoice_note, i.delivery_note],
      );
      return this.merchant(actor, actor.merchantId!);
    }
    throw new AppError('forbidden');
  }

  // ─── Приложение № 1: producer-merchant terms ───

  async pairs(actor: Actor, filter: { producerId?: string; merchantId?: string }) {
    if (actor.role === 'producer') filter = { producerId: actor.producerId! };
    if (actor.role === 'merchant') throw new AppError('forbidden');
    const col = filter.producerId ? 'pm.producer_id' : 'pm.merchant_id';
    const rows = await many<Record<string, unknown> & { last_order_on: string | null; active_period_days: number; total_net_cents: number; first_net_cents: number | null }>(
      this.deps.db,
      `SELECT pm.*, p.name AS producer_name, m.name AS merchant_name, m.eik AS merchant_eik, m.address AS merchant_address,
              (SELECT max(o.order_date) FROM orders o WHERE o.producer_id = pm.producer_id AND o.merchant_id = pm.merchant_id AND o.status <> 'cancelled') AS last_order_on,
              (SELECT count(*)::int FROM orders o WHERE o.producer_id = pm.producer_id AND o.merchant_id = pm.merchant_id AND o.status <> 'cancelled') AS orders,
              (SELECT coalesce(sum(o.net_cents - o.returned_net_cents), 0)::bigint FROM orders o WHERE o.producer_id = pm.producer_id AND o.merchant_id = pm.merchant_id AND o.status <> 'cancelled') AS total_net_cents,
              (SELECT o.net_cents - o.returned_net_cents FROM orders o WHERE o.producer_id = pm.producer_id AND o.merchant_id = pm.merchant_id AND o.status = 'delivered' ORDER BY o.order_date, o.number LIMIT 1) AS first_net_cents
         FROM producer_merchants pm JOIN producers p ON p.id = pm.producer_id JOIN merchants m ON m.id = pm.merchant_id
        WHERE ${col} = $1 ORDER BY m.name, p.name`,
      [filter.producerId ?? filter.merchantId],
    );
    const today = this.today();
    return rows.map((r) => ({
      ...r,
      // art. 17(3): active while the last order is within the activity period.
      active_buyer: r.last_order_on ? addDays(r.last_order_on, r.active_period_days) >= today : false,
    }));
  }

  async savePair(producerId: string, input: PairInput) {
    const m = await one(this.deps.db, 'SELECT 1 FROM merchants WHERE id = $1', [input.merchant_id]);
    const p = await one(this.deps.db, 'SELECT 1 FROM producers WHERE id = $1', [producerId]);
    if (!m || !p) throw new AppError('not_found');
    const r = await one<{ id: string }>(
      this.deps.db,
      `INSERT INTO producer_merchants (producer_id, merchant_id, status, introduced_on, introduced_how, territory, products_note,
              active_period_days, released_on, release_fee_cents, special_terms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (producer_id, merchant_id) DO UPDATE SET status=EXCLUDED.status,
              introduced_on=EXCLUDED.introduced_on, introduced_how=EXCLUDED.introduced_how, territory=EXCLUDED.territory,
              products_note=EXCLUDED.products_note, active_period_days=EXCLUDED.active_period_days, released_on=EXCLUDED.released_on,
              release_fee_cents=EXCLUDED.release_fee_cents, special_terms=EXCLUDED.special_terms, updated_at=now()
       RETURNING id`,
      [
        producerId,
        input.merchant_id,
        input.status,
        input.introduced_on,
        input.introduced_how,
        input.territory,
        input.products_note,
        input.active_period_days,
        input.released_on,
        input.release_fee,
        input.special_terms,
      ],
    );
    return { id: r!.id };
  }

  async deletePair(producerId: string, merchantId: string) {
    const used = await one(this.deps.db, 'SELECT 1 FROM orders WHERE producer_id = $1 AND merchant_id = $2 LIMIT 1', [producerId, merchantId]);
    if (used) throw new AppError('in_use');
    await this.deps.db.query('DELETE FROM producer_merchants WHERE producer_id = $1 AND merchant_id = $2', [producerId, merchantId]);
  }
}

export interface Commission {
  type: CommissionType;
  bp: number;
  unitCents: number;
}

/** The columns effectiveCommission() needs: whether the merchant carries commission, and the producer's terms. */
export interface PairCommissionRow {
  status: string;
  producer_commission_type: CommissionType;
  producer_commission_bp: number;
  producer_commission_unit_cents: number;
}

/** A pre-existing or released merchant carries no commission (art. 4(3), 5(4), 9); the others carry it. */
const exempt = (pair: { status: string } | null) => pair?.status === 'pre_existing' || pair?.status === 'released';

/** A good's own fixed commission applies unless the merchant carries no commission. */
export function goodCommissionApplies(pair: { status: string } | null): boolean {
  return !exempt(pair);
}

/** The commission of a new order: the producer's (a percent or a fixed amount per unit), or none. */
export function effectiveCommission(pair: PairCommissionRow | null): Commission {
  if (!pair) return { type: 'percent', bp: CONTRACT.defaultCommissionBp, unitCents: 0 };
  if (exempt(pair)) return { type: 'percent', bp: 0, unitCents: 0 };
  return { type: pair.producer_commission_type, bp: pair.producer_commission_bp, unitCents: pair.producer_commission_unit_cents };
}
