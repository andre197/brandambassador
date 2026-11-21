import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Deps } from '../deps.js';
import { AppError } from '../lib/errors.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const RATE_LIMITS = {
  login: { max: 10, timeWindow: '1 minute' },
  forgot: { max: 5, timeWindow: '1 minute' },
  token: { max: 30, timeWindow: '1 minute' },
} as const;

function requestOrigin(req: FastifyRequest): string | null {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== 'null') return origin.replace(/\/+$/, '');
  const referer = req.headers.referer;
  if (typeof referer === 'string') {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

function hasBody(req: FastifyRequest): boolean {
  const len = req.headers['content-length'];
  return (len !== undefined && Number(len) > 0) || req.headers['transfer-encoding'] !== undefined;
}

/**
 * CSRF defence for cookie-authenticated JSON APIs: every mutating request must come from an
 * allowed Origin and carry a JSON body (which cross-site HTML forms cannot send).
 */
export function checkCsrf(req: FastifyRequest, allowedOrigins: readonly string[]): void {
  if (!MUTATING.has(req.method)) return;
  const cfg = req.routeOptions.config ?? {};
  if (cfg.csrf === false) return;

  const origin = requestOrigin(req);
  if (!origin || !allowedOrigins.includes(origin)) {
    // Almost always a configuration mismatch (http vs https, www, another domain): say which.
    req.log.warn({ origin: origin ?? '(none sent)', allowed: allowedOrigins, url: req.url }, 'csrf: request origin is not in SITE_URL / ALLOWED_ORIGINS');
    throw new AppError('csrf_rejected');
  }
  if (!hasBody(req)) return;

  const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (type === 'application/json') return;
  if (type === 'multipart/form-data' && cfg.multipart) return;
  throw new AppError('unsupported_media_type');
}

export async function registerSecurity(app: FastifyInstance, deps: Deps): Promise<void> {
  await app.register(helmet, {
    // The API serves JSON and images; the web app sets its own CSP.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], imgSrc: ["'self'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // logo shown in mail clients
    hsts: deps.config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  });

  if (deps.config.RATE_LIMIT_ENABLED) {
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
      keyGenerator: (req) => req.ip,
      errorResponseBuilder: () => new AppError('rate_limited'),
    });
  }

  app.addHook('onRequest', async (req) => {
    checkCsrf(req, deps.config.allowedOrigins);
  });
}
