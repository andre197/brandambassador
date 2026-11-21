import type { Config } from './config.js';
import { createPool, type Pool } from './db/pool.js';
import { createEmailProvider, type EmailProvider } from './integrations/email/provider.js';
import { createLogger, type Logger } from './lib/logger.js';

/** Everything services need from the outside world. Tests build this with fakes. */
export interface Deps {
  config: Config;
  db: Pool;
  log: Logger;
  now: () => Date;
  email: EmailProvider;
}

export function createDeps(config: Config, overrides: Partial<Deps> = {}): Deps {
  const log = overrides.log ?? createLogger(config.LOG_LEVEL);
  return {
    config,
    db: overrides.db ?? createPool(config.DATABASE_URL),
    log,
    now: overrides.now ?? (() => new Date()),
    email: overrides.email ?? createEmailProvider(config, log),
  };
}

export async function closeDeps(deps: Deps): Promise<void> {
  await deps.db.end().catch(() => undefined);
}
