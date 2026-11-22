// Packs a built Brand Ambassador for shared hosting (cPanel "Setup Node.js App"): run `npm run build`
// on your own machine, then `npm run bundle:cpanel`, and upload deploy/brandambassador-cpanel.tar.gz.
// The server only installs packages and runs app.js - it never builds (shared hosting has too little
// memory for that). See docs/DEPLOYMENT.md.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'deploy/cpanel-bundle');
const archive = 'brandambassador-cpanel.tar.gz';
const from = (p) => path.join(root, p);
const to = (p) => path.join(out, p);
const json = (p) => JSON.parse(readFileSync(from(p), 'utf8'));

for (const need of ['apps/api/dist/src/app.js', 'apps/api/dist/src/cli/run-jobs.js', 'packages/shared/dist/index.js', 'apps/web/.next/BUILD_ID', 'apps/web/.next/required-server-files.json']) {
  if (!existsSync(from(need))) {
    console.error(`Missing ${need}. Run "npm run build" first.`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const copy = (src, dest = src, filter) => cpSync(from(src), to(dest), { recursive: true, ...(filter ? { filter } : {}) });

// ─── API (compiled JS and SQL migrations) ───
copy('apps/api/dist');
copy('apps/api/migrations');
writeFileSync(to('apps/api/package.json'), JSON.stringify({ name: '@ba/api', version: json('apps/api/package.json').version, private: true, type: 'module' }, null, 2));
// The shared package travels inside the API folder, so the host's package installer never touches it.
copy('packages/shared/dist', 'apps/api/node_modules/@ba/shared/dist');
const shared = json('packages/shared/package.json');
writeFileSync(
  to('apps/api/node_modules/@ba/shared/package.json'),
  JSON.stringify({ name: shared.name, version: shared.version, private: true, type: 'module', main: shared.main, exports: shared.exports }, null, 2),
);

// ─── Web (the production build, without caches, the dev build and the Docker-style standalone copy) ───
const skip = new Set(['cache', 'standalone', 'trace', 'trace-build', 'types', 'diagnostics', 'dev']);
copy('apps/web/.next', 'apps/web/.next', (src) => {
  // On Windows the copy hands over long-path names (\\?\D:\...).
  const rel = path.relative(from('apps/web/.next'), src.replace(/^\\\\\?\\/, '')).split(path.sep);
  return !skip.has(rel[0]);
});
if (existsSync(from('apps/web/public'))) copy('apps/web/public');
writeFileSync(to('apps/web/package.json'), JSON.stringify({ name: '@ba/web', version: json('apps/web/package.json').version, private: true }, null, 2));

// ─── Server entry, env template, package.json with the exact versions that were built and tested ───
copy('deploy/cpanel/app.js', 'app.js');
copy('deploy/cpanel/server.mjs', 'server.mjs');
copy('.env.cpanel.example', '.env.example');

const installed = (name) => {
  for (const base of ['node_modules', 'apps/api/node_modules', 'apps/web/node_modules']) {
    const p = path.join(base, name, 'package.json');
    if (existsSync(from(p))) return json(p).version;
  }
  throw new Error(`${name} is not installed; run "npm ci" first`);
};
const runtime = [
  ...Object.keys(json('apps/api/package.json').dependencies),
  ...Object.keys(shared.dependencies ?? {}),
  // The web build is self-contained except for these.
  'next',
  'react',
  'react-dom',
].filter((n) => !n.startsWith('@ba/'));
writeFileSync(
  to('package.json'),
  JSON.stringify(
    {
      name: 'brandambassador',
      version: json('apps/api/package.json').version,
      private: true,
      description: 'Built bundle of Brand Ambassador for cPanel Node.js hosting. Startup file: app.js',
      engines: { node: '>=20.12' },
      scripts: {
        start: 'node app.js',
        migrate: 'node apps/api/dist/src/cli/migrate.js',
        'create-admin': 'node apps/api/dist/src/cli/create-admin.js',
        jobs: 'node apps/api/dist/src/cli/run-jobs.js',
      },
      dependencies: Object.fromEntries([...new Set(runtime)].sort().map((n) => [n, installed(n)])),
      // The same pin as in development (see CLAUDE.md).
      overrides: json('package.json').overrides,
    },
    null,
    2,
  ),
);
writeFileSync(to('BUILD.txt'), `built ${new Date().toISOString()} · web build ${readFileSync(from('apps/web/.next/BUILD_ID'), 'utf8').trim()}\n`);

// Relative paths only: GNU tar reads "D:\..." as a remote host.
rmSync(from(`deploy/${archive}`), { force: true });
const tar = spawnSync('tar', ['-czf', archive, '-C', 'cpanel-bundle', '.'], { cwd: from('deploy'), stdio: 'inherit' });
if (tar.status !== 0) {
  console.error('Could not create the archive with "tar". The files are ready in deploy/cpanel-bundle - zip and upload that folder instead.');
  process.exit(1);
}
const mb = (statSync(from(`deploy/${archive}`)).size / 1024 / 1024).toFixed(1);
console.log(`\nBundle ready: deploy/${archive} (${mb} MB)\nUpload it to the application folder on the hosting and extract it there.`);
