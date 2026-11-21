// Starts the built storefront (Next.js standalone server) without Docker.
// Reads the repo-root .env like the API does; real environment variables win.
//   WEB_PORT (default 3300) and WEB_HOST (default 127.0.0.1: only the reverse proxy reaches it).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const dir = path.join(root, 'apps/web/.next/standalone/apps/web');
const server = path.join(dir, 'server.js');
if (!existsSync(server) || !existsSync(path.join(dir, '.next/static'))) {
  console.error('The web app is not built. Run "npm run build" first.');
  process.exit(1);
}

process.env.NODE_ENV = 'production';
process.env.PORT = process.env.WEB_PORT ?? '3300';
process.env.HOSTNAME = process.env.WEB_HOST ?? '127.0.0.1';
process.chdir(dir);
await import(pathToFileURL(server).href);
