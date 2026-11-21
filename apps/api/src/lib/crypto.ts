import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 random bytes, base64url - for session, cart, order and reset tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(secret: string, value: string | Buffer): Buffer {
  return createHmac('sha256', secret).update(value).digest();
}

export function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const ab = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** PKCE S256 challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
