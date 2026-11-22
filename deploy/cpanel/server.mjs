// Single-process server for shared hosting (cPanel "Setup Node.js App", Passenger, LiteSpeed).
// Those run ONE Node app per site and take over its listen() call, so the web app (Next.js) and
// the API (Fastify) are served from one HTTP server here:
//   /api/*          -> Fastify
//   everything else -> Next.js
// Emails and reminders run from a cron job instead of the worker (see run-jobs). On a VPS use the
// separate processes from README.md ("Production"); this file is only for hosts that allow one app.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Project root: the folder that holds apps/ (this file sits there in the bundle, two levels below in the repo). */
function findRoot() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    if (existsSync(path.join(dir, 'apps/api/dist/src/app.js'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('apps/api/dist not found: build first (npm run build) or upload the full bundle');
}
const root = findRoot();
const webDir = path.join(root, 'apps/web');
const envFile = path.join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.NODE_ENV = 'production';

const log = (msg, extra) => console.log(JSON.stringify({ level: 30, time: Date.now(), msg, ...extra }));
const fromRoot = (p) => import(pathToFileURL(path.join(root, p)).href);

let api = null; // Fastify instance
let web = null; // Next request handler
let failed = null;
let closeAll = async () => undefined; // set once the app has started

/** Shutdown never hangs: one try, then a hard exit after a few seconds. */
let stopping = false;
function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  log('app stopping', { reason });
  setTimeout(() => process.exit(0), 5000).unref();
  Promise.resolve()
    .then(() => closeAll())
    .catch(() => undefined)
    .finally(() => process.exit(0));
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => shutdown(sig));

// If the host's web server (our parent) goes away, nobody will send requests or a stop signal again.
const parentPid = process.ppid;
setInterval(() => {
  if (process.ppid !== parentPid) shutdown('parent process gone');
}, 30_000).unref();

// Under the host's wrapper (process name "lsnode:...") an idle copy exits; the host starts it again on
// the next visit (that first page takes a few seconds). IDLE_EXIT_MINUTES=0 turns it off.
const idleMinutes = Number(process.env.IDLE_EXIT_MINUTES ?? (process.title.startsWith('lsnode') ? 30 : 0));
let active = 0;
let lastRequest = Date.now();
if (idleMinutes > 0) {
  setInterval(() => {
    if (active === 0 && Date.now() - lastRequest > idleMinutes * 60_000) shutdown(`idle for ${idleMinutes} minutes`);
  }, 60_000).unref();
}

const isApi = (url) => {
  const p = url.split('?', 1)[0];
  return p === '/api' || p.startsWith('/api/');
};

function onRequest(req, res) {
  active++;
  lastRequest = Date.now();
  res.once('close', () => {
    active--;
    lastRequest = Date.now();
  });
  if (failed) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('Brand Ambassador failed to start. See the application log.');
    return;
  }
  if (!api || !web) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '5' }).end('Starting...');
    return;
  }
  if (isApi(req.url ?? '/')) api.routing(req, res);
  else
    web(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
}

/**
 * The web app fetches from the API while rendering (the sign-in check of every page). That goes over a
 * private loopback port of this same process, opened with net.Server's listen because hosting wrappers
 * replace http.Server's listen. If the host forbids it, those calls use the public address instead.
 */
async function internalOrigin() {
  if (process.env.BA_INTERNAL === 'public') return null;
  const server = http.createServer(onRequest);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      net.Server.prototype.listen.call(server, 0, '127.0.0.1', resolve);
    });
    server.unref();
    return `http://127.0.0.1:${net.Server.prototype.address.call(server).port}`;
  } catch (err) {
    log('no loopback port; internal calls use the public address', { err: err.message });
    return null;
  }
}

const main = http.createServer(onRequest);

try {
  const internal = (await internalOrigin()) ?? process.env.SITE_URL;
  process.env.INTERNAL_API_URL = internal;

  // ─── API ───
  await fromRoot('apps/api/dist/src/load-env.js');
  const { loadConfig } = await fromRoot('apps/api/dist/src/config.js');
  const { createDeps, closeDeps } = await fromRoot('apps/api/dist/src/deps.js');
  const { buildApp } = await fromRoot('apps/api/dist/src/app.js');
  const { bootstrap } = await fromRoot('apps/api/dist/src/bootstrap.js');
  const deps = createDeps(loadConfig());
  // AUTO_SETUP=true applies the migrations; ADMIN_LOGIN + ADMIN_PASSWORD create the first administrator.
  await bootstrap(deps);
  const app = await buildApp(deps);
  await app.ready();

  // ─── Web ───
  // The config saved by the build is used as is, so no next.config file (or TypeScript) is needed here.
  const required = JSON.parse(readFileSync(path.join(webDir, '.next/required-server-files.json'), 'utf8'));
  // The build baked in where /api/* is forwarded (the build machine's API address): point it at this process.
  const manifestFile = path.join(webDir, '.next/routes-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const repoint = (rules) => {
    for (const r of rules ?? []) if (String(r.source).startsWith('/api/')) r.destination = `${internal}/api/:path*`;
  };
  repoint(manifest.rewrites?.beforeFiles);
  repoint(required.config._originalRewrites?.beforeFiles);
  writeFileSync(manifestFile, JSON.stringify(manifest));
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(required.config);
  const next = createRequire(path.join(webDir, 'package.json'))('next');
  const nextApp = next({ dev: false, dir: webDir, conf: required.config });
  await nextApp.prepare();

  api = app;
  web = nextApp.getRequestHandler();

  closeAll = async () => {
    main.close();
    await app.close().catch(() => undefined);
    await closeDeps(deps);
  };
  log('app started', { internal, node: process.version, pid: process.pid, idleExitMinutes: idleMinutes });
} catch (err) {
  failed = err;
  console.error('Brand Ambassador failed to start:\n', err);
}

// Under cPanel/Passenger the port is ignored (their socket is used); standalone it is a real port.
main.listen(Number(process.env.PORT ?? 3500), process.env.WEB_HOST ?? '127.0.0.1');
