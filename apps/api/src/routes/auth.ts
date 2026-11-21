import { changePasswordSchema, forgotPasswordSchema, localeInputSchema, loginSchema, setPasswordSchema } from '@ba/shared';
import type { FastifyPluginAsync } from 'fastify';
import { clearSessionCookie, setSessionCookie } from '../lib/cookies.js';
import { parse } from '../lib/validate.js';
import { requireAuth } from '../plugins/auth.js';
import { RATE_LIMITS } from '../plugins/security.js';
import type { AuthState } from '../types.js';

const me = (a: AuthState | null) =>
  a ? { id: a.userId, email: a.email, name: a.name, role: a.role, producer_id: a.producerId, merchant_id: a.merchantId, locale: a.locale } : null;

const authRoutes: FastifyPluginAsync = async (app) => {
  const { auth, notifications } = app.services;
  const { config } = app.deps;

  app.post('/login', { config: { rateLimit: RATE_LIMITS.login } }, async (req, reply) => {
    const body = parse(loginSchema, req.body);
    const r = await auth.login(body.login, body.password, req.ctx);
    setSessionCookie(reply, config, r.token, r.expiresAt);
    return { user: { id: r.actor.userId, email: r.actor.email, name: r.actor.name, role: r.actor.role, locale: r.actor.locale } };
  });

  app.post('/logout', async (req, reply) => {
    if (req.auth) await auth.logout(req.auth.tokenHash);
    clearSessionCookie(reply, config);
    return { ok: true };
  });

  app.get('/me', async (req) => ({ user: me(req.auth), unread: req.auth ? await notifications.unread(req.auth) : 0 }));

  app.post('/password', async (req) => {
    const a = requireAuth(req);
    const body = parse(changePasswordSchema, req.body);
    await auth.changePassword(a, body.current, body.next);
    return { ok: true };
  });

  app.post('/locale', async (req) => {
    const a = requireAuth(req);
    await auth.setLocale(a, parse(localeInputSchema, req.body).locale);
    return { ok: true };
  });

  /** Always answers ok, so it does not reveal which addresses have an account. */
  app.post('/forgot', { config: { rateLimit: RATE_LIMITS.forgot } }, async (req) => {
    await auth.forgotPassword(parse(forgotPasswordSchema, req.body).email);
    return { ok: true };
  });

  app.post('/set-password', { config: { rateLimit: RATE_LIMITS.token } }, async (req) => {
    const body = parse(setPasswordSchema, req.body);
    return auth.setPassword(body.token, body.password);
  });
};

export default authRoutes;
