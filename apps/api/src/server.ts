import './load-env.js';
import { buildApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { loadConfig } from './config.js';
import { closeDeps, createDeps } from './deps.js';

const config = loadConfig();
const deps = createDeps(config);
await bootstrap(deps);
const app = await buildApp(deps);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await closeDeps(deps);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.API_HOST, port: config.API_PORT });
