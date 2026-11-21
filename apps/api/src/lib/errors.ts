export type ErrorCode =
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'csrf_rejected'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'invalid_credentials'
  | 'invalid_token'
  | 'conflict'
  | 'eik_taken'
  | 'email_taken'
  | 'in_use'
  | 'invalid_state'
  | 'good_unavailable'
  | 'internal';

const DEFAULT_STATUS: Partial<Record<ErrorCode, number>> = {
  validation_failed: 400,
  unauthorized: 401,
  invalid_credentials: 401,
  forbidden: 403,
  csrf_rejected: 403,
  not_found: 404,
  unsupported_media_type: 415,
  payload_too_large: 413,
  rate_limited: 429,
  conflict: 409,
  eik_taken: 409,
  email_taken: 409,
  in_use: 409,
  invalid_state: 409,
  good_unavailable: 409,
  invalid_token: 400,
  internal: 500,
};

/** An expected, user-facing error. `message_key` = `errors.<code>` in the web message files. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;

  constructor(code: ErrorCode, opts: { status?: number; fields?: Record<string, string>; message?: string } = {}) {
    super(opts.message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.status = opts.status ?? DEFAULT_STATUS[code] ?? 400;
    this.fields = opts.fields;
  }

  toBody() {
    return {
      error: {
        code: this.code,
        message_key: `errors.${this.code}`,
        ...(this.fields ? { fields: this.fields } : {}),
      },
    };
  }
}

export const notFound = () => new AppError('not_found');
export const validation = (fields: Record<string, string>) => new AppError('validation_failed', { fields });
