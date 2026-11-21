import '../load-env.js';
import { loadConfig } from '../config.js';
import { closeDeps, createDeps } from '../deps.js';
import { createServices } from '../services/index.js';

/**
 * One pass of the background worker, for hosts without long-running processes (cPanel):
 * run it from cron every minute. It works through due jobs for at most ~50 seconds.
 *   * * * * *  cd ~/opasenchar && node apps/api/dist/src/cli/run-jobs.js
 */
const deps = createDeps(loadConfig());
const { jobs } = createServices(deps);
const until = Date.now() + 50_000;
let total = 0;
try {
  await jobs.housekeeping();
  while (Date.now() < until) {
    const n = await jobs.runOnce(10);
    total += n;
    if (n === 0) break;
  }
  if (total) deps.log.info({ jobs: total }, 'jobs processed');
} catch (err) {
  deps.log.error({ err }, 'run-jobs failed');
  process.exitCode = 1;
} finally {
  await closeDeps(deps);
}
