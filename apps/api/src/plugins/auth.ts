import type { Role } from '@ba/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Deps } from '../deps.js';
import { SESSION_COOKIE } from '../lib/cookies.js';
import { hmacSha256 } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import type { Services } from '../services/index.js';
import type { AuthState } from '../types.js';

/** Attaches `request.ctx` and resolves `request.auth` from the session cookie. */
export function registerRequestContext(app: FastifyInstance, deps: Deps, services: Services): void {
  app.decorateRequest('auth', null);
  app.decorateRequest('ctx', null as never);

  app.addHook('onRequest', async (req) => {
    req.ctx = {
      ip: req.ip,
      ipHash: hmacSha256(deps.config.IP_HASH_SECRET, req.ip),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 500) : null,
    };
    const token = req.cookies[SESSION_COOKIE];
    req.auth = token ? await services.auth.resolve(token) : null;
  });
}

export function requireAuth(req: FastifyRequest, ...roles: Role[]): AuthState {
  if (!req.auth) throw new AppError('unauthorized');
  if (roles.length && !roles.includes(req.auth.role)) throw new AppError('forbidden');
  return req.auth;
}

export const requireAdmin = (req: FastifyRequest) => requireAuth(req, 'admin');
