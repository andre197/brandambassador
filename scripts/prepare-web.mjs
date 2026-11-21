// Run after `next build` (it is part of `npm run build`): the standalone web server does not
// include the static assets, so copy them next to it. Stop the web process before building.
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'apps/web');
const standalone = path.join(web, '.next/standalone/apps/web');

if (!existsSync(path.join(standalone, 'server.js'))) {
  console.error('No standalone build found. Run "npm run build" first.');
  process.exit(1);
}
for (const [from, to] of [
  [path.join(web, '.next/static'), path.join(standalone, '.next/static')],
  [path.join(web, 'public'), path.join(standalone, 'public')],
]) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}
console.log('web: static assets copied into the standalone build');
