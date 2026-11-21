import 'server-only';
import { cookies } from 'next/headers';
import { INTERNAL_API_URL } from './env';

export class ServerApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`API ${status} ${code}`);
  }
}

async function handle<T>(res: Response): Promise<T | null> {
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new ServerApiError(res.status, body?.error?.code ?? 'internal');
  }
  return (await res.json()) as T;
}

/** Forwards the visitor's cookies; never cached. Returns null for "not found". */
export async function privateApi<T>(path: string): Promise<T | null> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${INTERNAL_API_URL}/api/v1${path}`, {
    cache: 'no-store',
    headers: { accept: 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
  });
  return handle<T>(res);
}
