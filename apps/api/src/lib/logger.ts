import { pino, type Logger } from 'pino';

export type { Logger };

/** JSON logs. Personal data and secrets are redacted by path. */
export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', '*.password', '*.token', '*.email'],
      censor: '[redacted]',
    },
  });
}
