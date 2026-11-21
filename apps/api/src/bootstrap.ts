import { migrate } from './db/migrate.js';
import type { Deps } from './deps.js';
import { AuthService } from './services/auth.service.js';

/** The development login. Never created in production. */
export const DEV_ADMIN = { login: 'admin', password: 'admin' } as const;

/**
 * Start-up housekeeping, so a fresh install needs no commands:
 *  - AUTO_SETUP=true: apply pending migrations.
 *  - ADMIN_LOGIN + ADMIN_PASSWORD: create the first administrator, only while there is none.
 *  - Development only: admin / admin while there is no administrator at all.
 */
export async function bootstrap(deps: Deps): Promise<void> {
  const { config, db, log } = deps;

  if (config.AUTO_SETUP) {
    const applied = await migrate(db, (m) => log.info(m));
    log.info({ migrations: applied.length }, 'database set up');
  }

  try {
    const auth = new AuthService(deps);
    if ((await auth.adminCount()) > 0) {
      if (config.ADMIN_PASSWORD) log.info('an administrator already exists; ADMIN_LOGIN/ADMIN_PASSWORD are ignored (you can remove ADMIN_PASSWORD from .env)');
      return;
    }
    if (config.ADMIN_LOGIN && config.ADMIN_PASSWORD) {
      await auth.upsertAdmin(config.ADMIN_LOGIN, config.ADMIN_PASSWORD);
      log.info({ login: config.ADMIN_LOGIN }, 'first administrator created from ADMIN_LOGIN/ADMIN_PASSWORD - then remove ADMIN_PASSWORD from .env');
    } else if (!config.isProd) {
      await auth.upsertAdmin(DEV_ADMIN.login, DEV_ADMIN.password);
      log.info('development administrator created: admin / admin');
    } else {
      log.warn('there is no administrator: set ADMIN_LOGIN and ADMIN_PASSWORD, or run "npm run create-admin"');
    }
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'could not check the administrator (is the database migrated?)');
  }
}
