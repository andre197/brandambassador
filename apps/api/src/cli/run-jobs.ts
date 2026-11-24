import '../load-env.js';
import { loadConfig } from '../config.js';
import { closeDeps, createDeps } from '../deps.js';
import { createServices } from '../services/index.js';

/**
 * One pass of the background worker, for hosts without long-running processes (cPanel):
 * run it from cron every minute.
 *   * * * * *  cd ~/brandambassador && node apps/api/dist/src/cli/run-jobs.js
 *
 * It must never pile up, even when cron starts it again before the last run ended:
 *  - only one run at a time (a Postgres advisory lock; a second run exits at once),
 *  - no new job after ~40 seconds, and the process ends itself after 55 seconds whatever happens,
 *  - timeouts on the database and on SMTP, so a dead connection fails instead of hanging.
 * Jobs cut off by the hard stop stay `processing` and go back to the queue 5 minutes later (housekeeping).
 */
const STARTED = Date.now();
const LAST_JOB_START_MS = 40_000;
const HARD_STOP_MS = 55_000;
// Any fixed number: the lock is per database, so other apps on the same server do not collide with it.
const LOCK_KEY = 4_517_201;

// The watchdog: unref'd, so it never keeps a finished process alive, but it fires if something else does.
setTimeout(() => {
  console.error(JSON.stringify({ level: 50, time: Date.now(), msg: 'run-jobs hard stop: still running after 55 seconds' }));
  process.exit(2);
}, HARD_STOP_MS).unref();

const deps = createDeps(loadConfig(), {}, { queryTimeoutMs: 20_000 });
const { jobs } = createServices(deps);
let total = 0;
let code = 0;
try {
  // The lock lives on one connection and goes away with it, also when the process is killed.
  const lock = await deps.db.connect();
  try {
    const got = (await lock.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY])).rows[0]?.ok;
    if (!got) {
      deps.log.info('run-jobs: the previous run is still going; skipped');
    } else {
      const deadline = STARTED + LAST_JOB_START_MS;
      await jobs.housekeeping();
      while (Date.now() < deadline) {
        const n = await jobs.runOnce(5, deadline);
        total += n;
        if (n === 0) break;
      }
      await lock.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    lock.release();
  }
  if (total) deps.log.info({ jobs: total }, 'jobs processed');
} catch (err) {
  deps.log.error({ err }, 'run-jobs failed');
  code = 1;
} finally {
  // Closing waits for the pool; never longer than 5 seconds. Then exit even if a socket is still open.
  await Promise.race([closeDeps(deps), new Promise((r) => setTimeout(r, 5_000).unref())]);
  process.exit(code);
}
