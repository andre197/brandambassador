import '../src/load-env.js';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDeps, type Deps } from '../src/deps.js';
import { MemoryEmailProvider } from '../src/integrations/email/provider.js';
import { createServices, type Services } from '../src/services/index.js';

export const ORIGIN = 'http://localhost:3300';

export interface TestCtx {
  app: FastifyInstance;
  deps: Deps;
  services: Services;
  email: MemoryEmailProvider;
}

/** The app against the test database, with emails kept in memory. */
export async function makeApp(): Promise<TestCtx> {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL_TEST,
    SITE_URL: ORIGIN,
    EMAIL_PROVIDER: 'memory',
    RATE_LIMIT_ENABLED: 'false',
    LOG_LEVEL: 'silent',
  });
  const email = new MemoryEmailProvider();
  const deps = createDeps(config, { email });
  const services = createServices(deps);
  const app = await buildApp(deps, services);
  return { app, deps, services, email };
}

export async function resetDb(deps: Deps): Promise<void> {
  await deps.db.query(
    `TRUNCATE notifications, reminders, price_requests, order_events, commission_payments, order_payments, order_items, orders, agreed_prices,
              goods, password_tokens, sessions, users, producer_merchants, merchants, producers, outbox_jobs RESTART IDENTITY CASCADE`,
  );
  await deps.db.query(`UPDATE settings SET value = '{"default_commission_bp": 1000, "reminder_days_before": 3, "notify_emails": []}'::jsonb WHERE key = 'app'`);
}

/** Signs a user in and returns a request helper bound to its session. */
export async function signIn(t: TestCtx, login: string, password: string) {
  const res = await t.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGIN }, payload: { login, password } });
  const cookie = res.cookies.find((c) => c.name === 'ba_session');
  if (!cookie) throw new Error(`login failed: ${res.body}`);
  const header = `ba_session=${cookie.value}`;
  return async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
    const r = await t.app.inject({ method, url: `/api/v1${url}`, headers: { origin: ORIGIN, cookie: header }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
}

export const PASSWORD = 'correct-horse-battery';
