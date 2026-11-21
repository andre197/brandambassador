import { addDays, type Locale, sofiaToday } from '@ba/shared';
import { many, one, withTx } from '../db/pool.js';
import type { Deps } from '../deps.js';
import { renderPasswordEmail } from '../integrations/email/templates.js';
import { claimJobs, completeJob, failJob, type OutboxJob, releaseStaleJobs } from '../repositories/outbox.js';
import type { NotificationService } from './notification.service.js';
import { contractTerm } from './party.service.js';
import type { ReminderService } from './reminder.service.js';
import type { SettingsService } from './settings.service.js';

const HOUR_MS = 60 * 60 * 1000;

/** Processes the outbox (emails) and the hourly upkeep (reminders, contract renewals, cleanup). */
export class JobsService {
  private lastHousekeeping = 0;

  constructor(
    private readonly deps: Pick<Deps, 'db' | 'log' | 'now' | 'email' | 'config'>,
    private readonly notifications: NotificationService,
    private readonly reminders: ReminderService,
    private readonly settings: SettingsService,
  ) {}

  private async passwordEmail(p: { userId: string; token: string; purpose: 'invite' | 'reset' }) {
    const user = await one<{ email: string; locale: Locale }>(this.deps.db, 'SELECT email, locale FROM users WHERE id = $1 AND active', [p.userId]);
    if (!user || !user.email.includes('@')) return;
    const s = await this.settings.get();
    const url = `${this.deps.config.SITE_URL}/set-password?token=${encodeURIComponent(p.token)}`;
    await this.deps.email.send({ to: user.email, ...renderPasswordEmail(user.locale, { url, purpose: p.purpose, company: s.company_name }) });
  }

  private async handle(job: OutboxJob): Promise<void> {
    const p = job.payload as Record<string, string>;
    switch (job.type) {
      case 'email.password':
        return this.passwordEmail(p as never);
      case 'email.notice':
        return this.notifications.fanOut(p.notificationId!);
      case 'email.notice.to':
        return this.notifications.sendTo(p.notificationId!, p.email!, p.locale as Locale);
      default:
        this.deps.log.warn({ type: job.type }, 'unknown job type; dropped');
    }
  }

  /** Claims and runs up to `limit` due jobs; returns how many ran. */
  async runOnce(limit = 20): Promise<number> {
    const jobs = await claimJobs(this.deps.db, limit);
    for (const job of jobs) {
      try {
        await this.handle(job);
        await completeJob(this.deps.db, job.id);
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        this.deps.log.warn({ job: job.id, type: job.type, attempt: job.attempts, err: message }, 'job failed');
        await failJob(this.deps.db, job, message, Math.min(60 * 2 ** (job.attempts - 1), 3600));
      }
    }
    return jobs.length;
  }

  /** art. 19(2): tell the admin two weeks before the deadline for refusing the automatic renewal. */
  async contractNotices(): Promise<number> {
    const today = sofiaToday(this.deps.now());
    const rows = await many<{ id: string; name: string; contract_signed_on: string; contract_notice_sent_for: string | null }>(
      this.deps.db,
      'SELECT id, name, contract_signed_on, contract_notice_sent_for FROM producers WHERE active AND contract_signed_on IS NOT NULL',
    );
    let n = 0;
    for (const p of rows) {
      const term = contractTerm(p.contract_signed_on, today)!;
      if (p.contract_notice_sent_for === term.end || addDays(term.notice, -14) > today) continue;
      await withTx(this.deps.db, async (tx) => {
        await this.notifications.notify(tx, { audience: 'admin' }, 'contract_notice', { producer: p.name, end: term.end, notice: term.notice }, `/producers/${p.id}`);
        await tx.query('UPDATE producers SET contract_notice_sent_for = $2 WHERE id = $1', [p.id, term.end]);
      });
      n++;
    }
    return n;
  }

  /** Periodic upkeep (at most hourly). */
  async housekeeping(force = false): Promise<void> {
    const now = this.deps.now().getTime();
    if (!force && now - this.lastHousekeeping < HOUR_MS) return;
    this.lastHousekeeping = now;
    await releaseStaleJobs(this.deps.db);
    await this.deps.db.query(`DELETE FROM outbox_jobs WHERE status = 'done' AND created_at < now() - interval '30 days'`);
    await this.deps.db.query(`DELETE FROM sessions WHERE expires_at < now()`);
    await this.deps.db.query(`DELETE FROM password_tokens WHERE expires_at < now() - interval '7 days'`);
    const sent = await this.reminders.processDue();
    const notices = await this.contractNotices();
    if (sent || notices) this.deps.log.info({ reminders: sent, contractNotices: notices }, 'housekeeping');
  }
}
