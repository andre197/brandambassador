import { addDays, reminderInputSchema, type ReminderStatus, sofiaToday } from '@ba/shared';
import type { z } from 'zod';
import { many, one, withTx } from '../db/pool.js';
import type { Deps } from '../deps.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../types.js';
import type { NotificationService } from './notification.service.js';

type ReminderInput = z.output<typeof reminderInputSchema>;

const SELECT = `SELECT r.*, m.name AS merchant_name, p.name AS producer_name FROM reminders r
  JOIN merchants m ON m.id = r.merchant_id LEFT JOIN producers p ON p.id = r.producer_id`;

/**
 * Reminders to merchants about an order they have to place by a date. The merchant is told when the
 * reminder is created, again `remind_days_before` days ahead, and on the day. An order from the
 * merchant (to that producer) closes it.
 */
export class ReminderService {
  constructor(
    private readonly deps: Pick<Deps, 'db' | 'now' | 'log'>,
    private readonly notifications: NotificationService,
  ) {}

  async list(actor: Actor, filter: { merchantId?: string; status?: ReminderStatus }) {
    if (actor.role === 'producer') throw new AppError('forbidden');
    const params: unknown[] = [];
    const where: string[] = [];
    const merchantId = actor.role === 'merchant' ? actor.merchantId : filter.merchantId;
    if (merchantId) where.push(`r.merchant_id = $${params.push(merchantId)}`);
    if (filter.status) where.push(`r.status = $${params.push(filter.status)}`);
    if (actor.role === 'merchant') where.push(`r.status <> 'cancelled'`);
    return many(this.deps.db, `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY (r.status = 'open') DESC, r.due_on, r.created_at DESC LIMIT 300`, params);
  }

  private async send(db: Parameters<NotificationService['notify']>[0], reminderId: string) {
    const r = await one<{ id: string; merchant_id: string; due_on: string; message: string | null; producer_name: string | null }>(db, `${SELECT} WHERE r.id = $1`, [reminderId]);
    if (!r) return;
    await this.notifications.notify(db, { audience: 'merchant', merchantId: r.merchant_id }, 'reminder', { due: r.due_on, producer: r.producer_name, message: r.message }, '/orders/new');
    await db.query('UPDATE reminders SET last_sent_at = now() WHERE id = $1', [reminderId]);
  }

  async create(actor: Actor, input: ReminderInput) {
    if (actor.role !== 'admin') throw new AppError('forbidden');
    const ok = await one(this.deps.db, 'SELECT 1 FROM merchants WHERE id = $1', [input.merchant_id]);
    if (!ok) throw new AppError('not_found');
    return withTx(this.deps.db, async (tx) => {
      const r = await one<{ id: string }>(
        tx,
        `INSERT INTO reminders (merchant_id, producer_id, due_on, message, remind_days_before, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [input.merchant_id, input.producer_id, input.due_on, input.message, input.remind_days_before, actor.userId || null],
      );
      if (input.send_now) {
        await this.send(tx, r!.id);
        // Already inside the "days before" window: that email would only repeat this one.
        if (addDays(input.due_on, -input.remind_days_before) <= sofiaToday(this.deps.now())) {
          await tx.query('UPDATE reminders SET sent_before_at = now() WHERE id = $1', [r!.id]);
        }
      }
      return { id: r!.id };
    });
  }

  async update(actor: Actor, id: string, input: ReminderInput) {
    if (actor.role !== 'admin') throw new AppError('forbidden');
    const r = await this.deps.db.query(
      `UPDATE reminders SET merchant_id=$2, producer_id=$3, due_on=$4, message=$5, remind_days_before=$6,
              sent_before_at = CASE WHEN due_on = $4 THEN sent_before_at ELSE NULL END,
              sent_due_at = CASE WHEN due_on = $4 THEN sent_due_at ELSE NULL END, updated_at=now() WHERE id=$1`,
      [id, input.merchant_id, input.producer_id, input.due_on, input.message, input.remind_days_before],
    );
    if (!r.rowCount) throw new AppError('not_found');
    if (input.send_now) await withTx(this.deps.db, (tx) => this.send(tx, id));
    return { id };
  }

  /** The merchant marks it done; the admin may also cancel or reopen it. */
  async setStatus(actor: Actor, id: string, status: ReminderStatus) {
    if (actor.role === 'producer') throw new AppError('forbidden');
    if (actor.role === 'merchant' && status === 'cancelled') throw new AppError('forbidden');
    const params: unknown[] = [id, status];
    const own = actor.role === 'merchant' ? ` AND merchant_id = $${params.push(actor.merchantId)}` : '';
    const r = await this.deps.db.query(`UPDATE reminders SET status = $2, updated_at = now() WHERE id = $1${own}`, params);
    if (!r.rowCount) throw new AppError('not_found');
  }

  async remove(actor: Actor, id: string) {
    if (actor.role !== 'admin') throw new AppError('forbidden');
    await this.deps.db.query('DELETE FROM reminders WHERE id = $1', [id]);
  }

  /** Hourly: the "N days before" and "due today" emails. */
  async processDue(): Promise<number> {
    const today = sofiaToday(this.deps.now());
    const due = await many<{ id: string; due_on: string; remind_days_before: number; sent_before_at: string | null; sent_due_at: string | null }>(
      this.deps.db,
      `SELECT id, due_on, remind_days_before, sent_before_at, sent_due_at FROM reminders WHERE status = 'open' AND due_on <= $1::date + 60 AND (sent_due_at IS NULL)`,
      [today],
    );
    let sent = 0;
    for (const r of due) {
      const kind = r.due_on <= today ? 'due' : r.remind_days_before > 0 && !r.sent_before_at && addDays(r.due_on, -r.remind_days_before) <= today ? 'before' : null;
      if (!kind) continue;
      await withTx(this.deps.db, async (tx) => {
        await this.send(tx, r.id);
        await tx.query(`UPDATE reminders SET ${kind === 'due' ? 'sent_due_at' : 'sent_before_at'} = now() WHERE id = $1`, [r.id]);
      });
      sent++;
    }
    return sent;
  }
}
