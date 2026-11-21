// PM2 process file for running the app without Docker on a VPS.
//   npm install -g pm2
//   pm2 start ecosystem.config.cjs && pm2 save
// All three processes read the repo-root .env themselves.
module.exports = {
  apps: [
    { name: 'ba-api', script: 'apps/api/dist/src/server.js', cwd: __dirname, max_memory_restart: '300M' },
    { name: 'ba-worker', script: 'apps/api/dist/src/worker.js', cwd: __dirname, max_memory_restart: '200M' },
    { name: 'ba-web', script: 'scripts/start-web.mjs', cwd: __dirname, max_memory_restart: '500M' },
  ],
};
