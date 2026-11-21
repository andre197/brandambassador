'use client';

/** Error from the API envelope `{ error: { code, message_key, fields? } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly messageKey: string,
    readonly fields: Record<string, string> = {},
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

/**
 * Browser → same-origin `/api/v1/*`. Always sends JSON (the API's CSRF defence requires it);
 * cookies travel automatically. Network failures become `errors.network`.
 */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...(init.method && init.method !== 'GET' ? { 'content-type': 'application/json' } : {}) },
      body: init.method && init.method !== 'GET' ? JSON.stringify(init.body ?? {}) : undefined,
      signal: init.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'errors.network');
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { error?: { code: string; message_key: string; fields?: Record<string, string>; details?: Record<string, unknown> } } | null;
  if (!res.ok) {
    const e = body?.error;
    throw new ApiError(res.status, e?.code ?? 'internal', e?.message_key ?? 'errors.generic', e?.fields, e?.details);
  }
  return body as T;
}

/** Keys the web app knows how to translate; anything else falls back to errors.generic. */
export function errorKey(err: unknown): string {
  if (err instanceof ApiError) return err.messageKey;
  return 'errors.generic';
}
