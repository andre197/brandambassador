import type { Locale, NotificationType } from '@ba/shared';
import { many, one, type Queryable } from '../db/pool.js';
import type { Deps } from '../deps.js';
import { renderNoticeEmail } from '../integrations/email/templates.js';
import { AppError } from '../lib/errors.js';
import { enqueueJob } from '../repositories/outbox.js';
import type { Actor } from '../types.js';
import type { SettingsService } from './settings.service.js';

export type Target = { audience: 'admin' } | { audience: 'producer'; producerId: string } | { audience: 'merchant'; merchantId: string };

export interface NotificationRow {
  id: string;
  type: NotificationType;
  data: Record<string, unknown>;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/** The notifications a signed-in user sees: their party's (or the admin's). */
function audienceWhere(actor: Actor): { sql: string; params: unknown[] } {
  if (actor.role === 'producer') return { sql: `audience = 'producer' AND producer_id = $1`, params: [actor.producerId] };
  if (actor.role === 'merchant') return { sql: `audience = 'merchant' AND merchant_id = $1`, params: [actor.merchantId] };
  return { sql: `audience = 'admin'`, params: [] };
}

/** In-app notices plus an email to everyone concerned (through the outbox, in each reader's language). */
export class NotificationService {
  constructor(
    private readonly deps: Pick<Deps, 'db' | 'log' | 'email' | 'config'>,
    private readonly settings: SettingsService,
  ) {}

  /** Call with the transaction of the change, so the notice exists if and only if the change committed. */
  async notify(db: Queryable, target: Target, type: NotificationType, data: Record<string, unknown>, link: string | null = null, opts: { email?: boolean } = {}): Promise<void> {
    const row = await one<{ id: string }>(
      db,
      `INSERT INTO notifications (audience, producer_id, merchant_id, type, data, link) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [target.audience, target.audience === 'producer' ? target.producerId : null, target.audience === 'merchant' ? target.merchantId : null, type, JSON.stringify(data), link],
    );
    if (opts.email !== false) await enqueueJob(db, 'email.notice', { notificationId: row!.id }, { dedupeKey: `notice:${row!.id}` });
  }

  async list(actor: Actor, limit = 50): Promise<{ items: NotificationRow[]; unread: number }> {
    const w = audienceWhere(actor);
    const items = await many<NotificationRow>(this.deps.db, `SELECT id, type, data, link, read_at, created_at FROM notifications WHERE ${w.sql} ORDER BY created_at DESC LIMIT ${Number(limit)}`, w.params);
    const unread = (await one<{ n: number }>(this.deps.db, `SELECT count(*)::int AS n FROM notifications WHERE ${w.sql} AND read_at IS NULL`, w.params))!.n;
    return { items, unread };
  }

  async unread(actor: Actor): Promise<number> {
    const w = audienceWhere(actor);
    return (await one<{ n: number }>(this.deps.db, `SELECT count(*)::int AS n FROM notifications WHERE ${w.sql} AND read_at IS NULL`, w.params))!.n;
  }

  async markRead(actor: Actor, ids: string[] | null): Promise<void> {
    const w = audienceWhere(actor);
    if (ids === null) {
      await this.deps.db.query(`UPDATE notifications SET read_at = now() WHERE ${w.sql} AND read_at IS NULL`, w.params);
      return;
    }
    await this.deps.db.query(`UPDATE notifications SET read_at = now() WHERE ${w.sql} AND read_at IS NULL AND id = ANY($${w.params.length + 1}::uuid[])`, [...w.params, ids]);
  }

  /** Who gets the email for a notice: the party's users in their language; the party's own address when nobody has an account. */
  private async recipients(n: { audience: string; producer_id: string | null; merchant_id: string | null }): Promise<{ email: string; locale: Locale }[]> {
    const out = new Map<string, Locale>();
    if (n.audience === 'admin') {
      const s = await this.settings.get();
      for (const u of await many<{ email: string; locale: Locale }>(this.deps.db, `SELECT email, locale FROM users WHERE role = 'admin' AND active AND email LIKE '%@%'`)) out.set(u.email, u.locale);
      for (const e of s.notify_emails) if (!out.has(e)) out.set(e, 'bg');
    } else {
      const col = n.audience === 'producer' ? 'producer_id' : 'merchant_id';
      const id = n.audience === 'producer' ? n.producer_id : n.merchant_id;
      for (const u of await many<{ email: string; locale: Locale }>(this.deps.db, `SELECT email, locale FROM users WHERE ${col} = $1 AND active`, [id])) out.set(u.email, u.locale);
      if (!out.size) {
        const table = n.audience === 'producer' ? 'producers' : 'merchants';
        const party = await one<{ email: string }>(this.deps.db, `SELECT email FROM ${table} WHERE id = $1`, [id]);
        if (party?.email) out.set(party.email, 'bg');
      }
    }
    return [...out].map(([email, locale]) => ({ email, locale }));
  }

  private loadNotice(id: string) {
    return one<{ audience: string; producer_id: string | null; merchant_id: string | null; type: NotificationType; data: Record<string, unknown>; link: string | null }>(
      this.deps.db,
      'SELECT audience, producer_id, merchant_id, type, data, link FROM notifications WHERE id = $1',
      [id],
    );
  }

  /** Outbox job: one email job per recipient, so a retry never sends twice to the others. */
  async fanOut(notificationId: string): Promise<void> {
    const n = await this.loadNotice(notificationId);
    if (!n) return;
    const recipients = await this.recipients(n);
    if (!recipients.length) this.deps.log.warn({ notificationId, audience: n.audience }, 'notice has no email recipient');
    for (const r of recipients) {
      await enqueueJob(this.deps.db, 'email.notice.to', { notificationId, email: r.email, locale: r.locale }, { dedupeKey: `notice:${notificationId}:${r.email}` });
    }
  }

  async sendTo(notificationId: string, email: string, locale: Locale): Promise<void> {
    const n = await this.loadNotice(notificationId);
    if (!n) return;
    const s = await this.settings.get();
    const mail = renderNoticeEmail(locale, { siteUrl: this.deps.config.SITE_URL, type: n.type, data: n.data, link: n.link, company: s.company_name });
    await this.deps.email.send({ to: email, ...mail });
  }

  ensureOwn(actor: Actor, row: { producer_id: string | null; merchant_id: string | null }): void {
    if (actor.role === 'producer' && row.producer_id !== actor.producerId) throw new AppError('not_found');
    if (actor.role === 'merchant' && row.merchant_id !== actor.merchantId) throw new AppError('not_found');
  }
}
