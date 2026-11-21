import './load-env.js';
import { loadConfig } from './config.js';
import { closeDeps, createDeps } from './deps.js';
import { createServices } from './services/index.js';

/**
 * Outbox worker: notification and invitation emails, plus the hourly upkeep (order reminders to
 * merchants, contract renewal notices). Safe to run several instances (SKIP LOCKED + dedupe keys).
 */
const config = loadConfig();
const deps = createDeps(config);
const { jobs } = createServices(deps);

let running = true;
const stop = () => {
  running = false;
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

deps.log.info({ pollMs: config.WORKER_POLL_MS }, 'worker started');
while (running) {
  try {
    await jobs.housekeeping();
    const n = await jobs.runOnce(20);
    if (n === 0) await new Promise((r) => setTimeout(r, config.WORKER_POLL_MS));
  } catch (err) {
    deps.log.error({ err }, 'worker loop error');
    await new Promise((r) => setTimeout(r, config.WORKER_POLL_MS * 2));
  }
}
deps.log.info('worker stopped');
await closeDeps(deps);
