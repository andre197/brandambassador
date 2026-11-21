import type { Locale, Role } from '@ba/shared';
import { many, one } from '../db/pool.js';
import type { Deps } from '../deps.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { burnVerifyTime, hashPassword, needsRehash, verifyPassword } from '../lib/password.js';
import { enqueueJob } from '../repositories/outbox.js';
import type { Actor, AuthState, ReqCtx } from '../types.js';

const HOUR = 60 * 60 * 1000;
/** Sessions end after 7 days without activity, and after 30 days in any case. */
export const SESSION_IDLE_MS = 7 * 24 * HOUR;
export const SESSION_ABSOLUTE_MS = 30 * 24 * HOUR;
const TOUCH_EVERY_MS = 15 * 60 * 1000;
const INVITE_MS = 7 * 24 * HOUR;
const RESET_MS = 2 * HOUR;

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  producer_id: string | null;
  merchant_id: string | null;
  locale: Locale;
  active: boolean;
}

export interface UserView {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  locale: Locale;
  active: boolean;
  has_password: boolean;
  last_login_at: string | null;
  created_at: string;
}

const toActor = (u: UserRow): Actor => ({
  userId: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  producerId: u.producer_id,
  merchantId: u.merchant_id,
  locale: u.locale,
});

export class AuthService {
  constructor(private readonly deps: Pick<Deps, 'db' | 'now'>) {}

  async login(login: string, password: string, ctx: ReqCtx): Promise<{ token: string; expiresAt: Date; actor: Actor }> {
    const user = await one<UserRow & { password_hash: string | null }>(
      this.deps.db,
      `SELECT u.id, u.email, u.name, u.role, u.producer_id, u.merchant_id, u.locale, u.active, u.password_hash
         FROM users u
         LEFT JOIN producers p ON p.id = u.producer_id
         LEFT JOIN merchants m ON m.id = u.merchant_id
        WHERE u.email = $1 AND u.active AND coalesce(p.active, m.active, true)`,
      [login],
    );
    if (!user?.password_hash) {
      await burnVerifyTime(password);
      throw new AppError('invalid_credentials');
    }
    if (!(await verifyPassword(user.password_hash, password))) throw new AppError('invalid_credentials');
    if (needsRehash(user.password_hash)) {
      await this.deps.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(password)]);
    }
    const token = randomToken();
    const expiresAt = new Date(this.deps.now().getTime() + SESSION_IDLE_MS);
    await this.deps.db.query('INSERT INTO sessions (user_id, token_hash, expires_at, ip_hash, user_agent) VALUES ($1, $2, $3, $4, $5)', [
      user.id,
      sha256(token),
      expiresAt,
      ctx.ipHash,
      ctx.userAgent,
    ]);
    await this.deps.db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    return { token, expiresAt, actor: toActor(user) };
  }

  /** Resolves a session cookie, applying idle and absolute expiry. Deactivated users and parties are signed out. */
  async resolve(token: string): Promise<AuthState | null> {
    if (token.length > 200) return null;
    const hash = sha256(token);
    const row = await one<UserRow & { session_id: string; created_at: Date; last_seen_at: Date; party_active: boolean }>(
      this.deps.db,
      `SELECT s.id AS session_id, s.created_at, s.last_seen_at,
              u.id, u.email, u.name, u.role, u.producer_id, u.merchant_id, u.locale, u.active,
              coalesce(p.active, m.active, true) AS party_active
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN producers p ON p.id = u.producer_id
         LEFT JOIN merchants m ON m.id = u.merchant_id
        WHERE s.token_hash = $1`,
      [hash],
    );
    if (!row) return null;
    const now = this.deps.now().getTime();
    const created = new Date(row.created_at).getTime();
    const seen = new Date(row.last_seen_at).getTime();
    if (!row.active || !row.party_active || now - seen > SESSION_IDLE_MS || now - created > SESSION_ABSOLUTE_MS) {
      await this.deps.db.query('DELETE FROM sessions WHERE id = $1', [row.session_id]);
      return null;
    }
    if (now - seen > TOUCH_EVERY_MS) {
      const expiresAt = new Date(Math.min(now + SESSION_IDLE_MS, created + SESSION_ABSOLUTE_MS));
      await this.deps.db.query('UPDATE sessions SET last_seen_at = now(), expires_at = $2 WHERE id = $1', [row.session_id, expiresAt]);
    }
    return { ...toActor(row), sessionId: row.session_id, tokenHash: hash };
  }

  async logout(tokenHash: Buffer): Promise<void> {
    await this.deps.db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  /** Changes the password and signs out every other session. */
  async changePassword(auth: AuthState, current: string, next: string): Promise<void> {
    const row = await one<{ password_hash: string | null }>(this.deps.db, 'SELECT password_hash FROM users WHERE id = $1', [auth.userId]);
    if (!row?.password_hash || !(await verifyPassword(row.password_hash, current))) {
      throw new AppError('validation_failed', { fields: { current: 'validation.wrong_password' } });
    }
    await this.deps.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [auth.userId, await hashPassword(next)]);
    await this.deps.db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [auth.userId, auth.sessionId]);
  }

  async setLocale(auth: AuthState, locale: Locale): Promise<void> {
    await this.deps.db.query('UPDATE users SET locale = $2 WHERE id = $1', [auth.userId, locale]);
  }

  // ─── Invitations and password reset ───

  private async issueToken(userId: string, purpose: 'invite' | 'reset'): Promise<string> {
    const token = randomToken();
    await this.deps.db.query('DELETE FROM password_tokens WHERE user_id = $1 AND used_at IS NULL', [userId]);
    await this.deps.db.query('INSERT INTO password_tokens (user_id, token_hash, purpose, expires_at) VALUES ($1, $2, $3, $4)', [
      userId,
      sha256(token),
      purpose,
      new Date(this.deps.now().getTime() + (purpose === 'invite' ? INVITE_MS : RESET_MS)),
    ]);
    return token;
  }

  /** Emails a link to choose a password. Unknown or inactive addresses are ignored silently. */
  async forgotPassword(email: string): Promise<void> {
    const user = await one<{ id: string }>(this.deps.db, `SELECT id FROM users WHERE email = $1 AND active AND email LIKE '%@%'`, [email]);
    if (!user) return;
    const token = await this.issueToken(user.id, 'reset');
    await enqueueJob(this.deps.db, 'email.password', { userId: user.id, token, purpose: 'reset' });
  }

  async sendInvite(userId: string): Promise<void> {
    const token = await this.issueToken(userId, 'invite');
    await enqueueJob(this.deps.db, 'email.password', { userId, token, purpose: 'invite' });
  }

  /** Uses an invitation or reset link. Signs out every session of the user. */
  async setPassword(token: string, password: string): Promise<{ email: string }> {
    const row = await one<{ id: string; user_id: string; email: string }>(
      this.deps.db,
      `SELECT t.id, t.user_id, u.email FROM password_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > $2 AND u.active`,
      [sha256(token), this.deps.now()],
    );
    if (!row) throw new AppError('invalid_token');
    await this.deps.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [row.user_id, await hashPassword(password)]);
    await this.deps.db.query('UPDATE password_tokens SET used_at = now() WHERE id = $1', [row.id]);
    await this.deps.db.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]);
    return { email: row.email };
  }

  // ─── Users (admin) ───

  async listUsers(filter: { producerId?: string; merchantId?: string; admins?: boolean }): Promise<UserView[]> {
    const where = filter.producerId ? 'producer_id = $1' : filter.merchantId ? 'merchant_id = $1' : `role = 'admin'`;
    const params = filter.producerId ? [filter.producerId] : filter.merchantId ? [filter.merchantId] : [];
    return many<UserView>(
      this.deps.db,
      `SELECT id, email, name, role, locale, active, password_hash IS NOT NULL AS has_password, last_login_at, created_at
         FROM users WHERE ${where} ORDER BY created_at`,
      params,
    );
  }

  async createUser(input: { email: string; name: string | null; locale: Locale; password: string | null; role: Role; producerId?: string | null; merchantId?: string | null }): Promise<UserView> {
    const exists = await one(this.deps.db, 'SELECT 1 FROM users WHERE email = $1', [input.email]);
    if (exists) throw new AppError('email_taken', { fields: { email: 'validation.email_taken' } });
    const row = await one<{ id: string }>(
      this.deps.db,
      `INSERT INTO users (email, name, role, producer_id, merchant_id, locale, password_hash) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [input.email, input.name, input.role, input.producerId ?? null, input.merchantId ?? null, input.locale, input.password ? await hashPassword(input.password) : null],
    );
    if (!input.password) await this.sendInvite(row!.id);
    return (await this.user(row!.id))!;
  }

  async user(id: string): Promise<(UserView & { producer_id: string | null; merchant_id: string | null }) | null> {
    return one(
      this.deps.db,
      `SELECT id, email, name, role, locale, active, producer_id, merchant_id, password_hash IS NOT NULL AS has_password, last_login_at, created_at
         FROM users WHERE id = $1`,
      [id],
    );
  }

  async setUserActive(id: string, active: boolean): Promise<void> {
    await this.deps.db.query('UPDATE users SET active = $2 WHERE id = $1', [id, active]);
    if (!active) await this.deps.db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
  }

  async deleteUser(id: string, self: Actor): Promise<void> {
    if (id === self.userId) throw new AppError('invalid_state');
    const u = await this.user(id);
    if (!u) throw new AppError('not_found');
    if (u.role === 'admin' && (await this.adminCount()) <= 1) throw new AppError('invalid_state');
    await this.deps.db.query('DELETE FROM users WHERE id = $1', [id]);
  }

  /** Creates an administrator, or sets a new password for an existing one. */
  async upsertAdmin(login: string, password: string): Promise<{ id: string; created: boolean }> {
    const existing = await one<{ role: string }>(this.deps.db, 'SELECT role FROM users WHERE email = $1', [login]);
    if (existing && existing.role !== 'admin') throw new Error(`${login} is a ${existing.role} account, not an administrator`);
    const hash = await hashPassword(password);
    const row = await one<{ id: string; created: boolean; role: string }>(
      this.deps.db,
      `INSERT INTO users (email, role, password_hash) VALUES ($1, 'admin', $2)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id, role, (xmax = 0) AS created`,
      [login, hash],
    );
    if (row!.role !== 'admin') throw new Error(`${login} is a ${row!.role} account, not an administrator`);
    if (!row!.created) await this.deps.db.query('DELETE FROM sessions WHERE user_id = $1', [row!.id]);
    return row!;
  }

  async adminCount(): Promise<number> {
    return (await one<{ n: number }>(this.deps.db, `SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active`))!.n;
  }
}
