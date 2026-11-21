import type { Locale, Role } from '@ba/shared';

/** Per-request context passed from routes to services (never the raw request). */
export interface ReqCtx {
  ip: string;
  ipHash: Buffer;
  userAgent: string | null;
}

/** The signed-in user. A producer or merchant user always carries its party id. */
export interface Actor {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  producerId: string | null;
  merchantId: string | null;
  locale: Locale;
}

export interface AuthState extends Actor {
  sessionId: string;
  tokenHash: Buffer;
}

/** The worker and CLI act as the system. */
export const SYSTEM: Actor = { userId: '', email: 'system', name: null, role: 'admin', producerId: null, merchantId: null, locale: 'bg' };
