import type { FastifyReply } from 'fastify';
import type { Config } from '../config.js';

export const SESSION_COOKIE = 'ba_session';

export function baseCookie(config: Config) {
  return { path: '/', httpOnly: true, secure: config.secureCookies, sameSite: 'lax' as const };
}

export function setSessionCookie(reply: FastifyReply, config: Config, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, { ...baseCookie(config), expires: expiresAt });
}

export function clearSessionCookie(reply: FastifyReply, config: Config): void {
  reply.clearCookie(SESSION_COOKIE, baseCookie(config));
}
