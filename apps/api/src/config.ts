import { loginIdSchema } from '@ba/shared';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const optionalStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const secret = (name: string) => z.string(`${name} is required`).min(32, `${name} must be at least 32 characters`);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    SITE_URL: z.url().transform((u) => u.replace(/\/+$/, '')),
    ALLOWED_ORIGINS: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean) : [])),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    API_HOST: z.string().default('0.0.0.0'),
    API_PORT: z.coerce.number().int().default(4300),
    TRUST_PROXY: bool(false),

    DATABASE_URL: z.string().min(1),

    IP_HASH_SECRET: secret('IP_HASH_SECRET'),

    EMAIL_PROVIDER: z.enum(['console', 'smtp', 'memory']).default('console'),
    EMAIL_FROM: z.string().default('Brand Ambassador <no-reply@example.com>'),
    SMTP_HOST: optionalStr,
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_SECURE: bool(false),
    SMTP_USER: optionalStr,
    SMTP_PASS: optionalStr,
    SMTP_OAUTH_CLIENT_ID: optionalStr,
    SMTP_OAUTH_CLIENT_SECRET: optionalStr,
    SMTP_OAUTH_REFRESH_TOKEN: optionalStr,

    WORKER_POLL_MS: z.coerce.number().int().min(100).default(2000),
    RATE_LIMIT_ENABLED: bool(true),

    AUTO_SETUP: bool(false),
    ADMIN_LOGIN: optionalStr.transform((v) => v?.toLowerCase()),
    ADMIN_PASSWORD: optionalStr,
  })
  .superRefine((env, ctx) => {
    if (env.ADMIN_LOGIN && !loginIdSchema.safeParse(env.ADMIN_LOGIN).success) {
      ctx.addIssue({ code: 'custom', path: ['ADMIN_LOGIN'], message: 'ADMIN_LOGIN must be an email or a username of 3-50 characters: letters, digits, dot, underscore, dash' });
    }
    if (env.ADMIN_PASSWORD && !env.ADMIN_LOGIN) {
      ctx.addIssue({ code: 'custom', path: ['ADMIN_PASSWORD'], message: 'ADMIN_PASSWORD is set but ADMIN_LOGIN is empty' });
    }
    if (env.ADMIN_PASSWORD && (env.ADMIN_PASSWORD.length < 10 || env.ADMIN_PASSWORD.length > 128)) {
      ctx.addIssue({ code: 'custom', path: ['ADMIN_PASSWORD'], message: `ADMIN_PASSWORD must be 10 to 128 characters (it has ${env.ADMIN_PASSWORD.length})` });
    }
    if (env.EMAIL_PROVIDER === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'Required when EMAIL_PROVIDER=smtp' });
    }
    const oauth = [env.SMTP_OAUTH_CLIENT_ID, env.SMTP_OAUTH_CLIENT_SECRET, env.SMTP_OAUTH_REFRESH_TOKEN];
    if (oauth.some(Boolean)) {
      if (!oauth.every(Boolean)) {
        ctx.addIssue({ code: 'custom', path: ['SMTP_OAUTH_REFRESH_TOKEN'], message: 'Set SMTP_OAUTH_CLIENT_ID, SMTP_OAUTH_CLIENT_SECRET and SMTP_OAUTH_REFRESH_TOKEN together (npm run gmail-token gets the token)' });
      }
      if (!env.SMTP_USER) ctx.addIssue({ code: 'custom', path: ['SMTP_USER'], message: 'OAuth2 needs SMTP_USER: the mailbox the token belongs to' });
      if (env.SMTP_PASS) ctx.addIssue({ code: 'custom', path: ['SMTP_PASS'], message: 'Use SMTP_PASS or the SMTP_OAUTH_* settings, not both' });
    }
    if (env.NODE_ENV === 'production' && env.EMAIL_PROVIDER === 'memory') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'The memory email provider is for tests only' });
    }
    if (env.NODE_ENV === 'production' && !env.SITE_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['SITE_URL'], message: 'SITE_URL must use https in production' });
    }
  });

export type Env = z.infer<typeof envSchema>;

export interface Config extends Env {
  isProd: boolean;
  isTest: boolean;
  /** Cookies get the Secure flag whenever the app is served over https. */
  secureCookies: boolean;
  allowedOrigins: string[];
}

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  const allowed = new Set([env.SITE_URL, ...env.ALLOWED_ORIGINS]);
  // The www and non-www forms of an allowed address are the same site.
  for (const o of [...allowed]) {
    try {
      const u = new URL(o);
      if (u.hostname === 'localhost' || /^[\d.]+$/.test(u.hostname)) continue;
      u.hostname = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`;
      allowed.add(u.origin);
    } catch {
      // not a URL; left as given
    }
  }
  return {
    ...env,
    isProd: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    secureCookies: env.SITE_URL.startsWith('https://'),
    allowedOrigins: [...allowed],
  };
}
