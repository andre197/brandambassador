# Deployment

Two ways to run Brand Ambassador in production:

- **Shared hosting with cPanel** ("Setup Node.js App", PostgreSQL, cron): one Node app, built on your own computer. See below.
- **A VPS**: the three processes (API, worker, web) behind a reverse proxy. See README.md, "Production".

## Shared hosting (cPanel "Setup Node.js App")

Shared hosting runs **one Node app per site**, has no long-running background processes and too little memory to build, so the app runs like this:

```
Browser ──HTTPS──► the host's web server ──► app.js  (ONE process: web + API)  ──► PostgreSQL
                                              cron, every minute ──► run-jobs.js (emails, reminders, contract notices)
```

- **Build on your own computer, upload the result.** The server only installs packages.
- `deploy/cpanel/server.mjs` serves `/api/*` with the API and everything else with the web app, from one listener.
- The worker is a **cron job** that does the pending work and exits.

Requirements: **Node.js 20.12 or newer** in "Setup Node.js App" (22 or 24 preferred), **PostgreSQL 13 or newer**, and HTTPS on the domain.

### 1. On your computer

```bash
npm ci
npm run build
npm run bundle:cpanel        # → deploy/brandambassador-cpanel.tar.gz  (about 3 MB)
```

### 2. In cPanel, once

1. **SSL/TLS Status** → make sure the domain has a certificate (free Let's Encrypt).
2. **PostgreSQL Databases** → create a database and a user, and add the user to the database with all privileges.
3. **Email Accounts** → create the mailbox that sends the notifications (e.g. `no-reply@your-domain`). "Connect Devices" shows the SMTP host and port.
4. **Setup Node.js App → Create Application**: Node.js 24 (or 22), mode **Production**, application root e.g. `brandambassador`, application URL = your domain, startup file **`app.js`**.
5. **File Manager** → open the application root, upload `brandambassador-cpanel.tar.gz` and **Extract** it there (overwrite the placeholder `app.js`).
6. Copy `.env.example` to `.env` in that folder and fill in every line marked `FILL IN`:
   - `SITE_URL`: the https address.
   - `DATABASE_URL`: the database and user from step 2.
   - `ADMIN_LOGIN` and `ADMIN_PASSWORD`: your administrator (password 10 to 128 characters).
   - `IP_HASH_SECRET`: 32+ random characters.
   - For real emails: `EMAIL_PROVIDER=smtp` and the SMTP lines, with the mailbox from step 3.
7. Back in **Setup Node.js App** → your app → **Run NPM Install**.

### 3. Start - no commands needed

Press **Restart** on the Node.js App page and open the site. On start (with `AUTO_SETUP=true`, the default in this `.env`) the app creates its tables and creates the administrator from `ADMIN_LOGIN` / `ADMIN_PASSWORD` while there is none.

- `https://your-domain/api/v1/health` should answer `{"ok":true}`.
- Sign in at `https://your-domain/login` with `ADMIN_LOGIN` and `ADMIN_PASSWORD`. **Then remove `ADMIN_PASSWORD` from `.env`** (it is never used again once an administrator exists).
- The development login `admin` / `admin` is never created in production.

If the site shows "Brand Ambassador failed to start", the reason is in the app's log (`stderr.log` in the application root, or the log file set on the Node.js App page). Usually it is a missing or wrong value in `.env`, and the message names it.

To set a new administrator password (or add another administrator), use the terminal: enter the app's environment (the Node.js App page shows the command, like `source /home/USER/nodevenv/brandambassador/24/bin/activate && cd /home/USER/brandambassador`) and run `npm run create-admin -- --login you@example.com`. It asks for the password.

### 4. The cron job (required)

**Cron Jobs** → add a job that runs **every minute** (`* * * * *`), with the paths of your account:

```
flock -n /home/USER/brandambassador/.jobs.lock -c "cd /home/USER/brandambassador && timeout 150 /home/USER/nodevenv/brandambassador/24/bin/node apps/api/dist/src/cli/run-jobs.js >> /home/USER/brandambassador/jobs.log 2>&1"
```

Without it no emails are sent (new orders, price requests, invitations, password resets), and the "place an order by" reminders and contract renewal notices never go out. `flock -n` skips a minute while the previous run is still going, and `timeout 150` ends a run that hangs. If the host has no `flock`, the plain `cd ... && node ...` part works too.

### 5. Updating

1. On your computer: `npm run build && npm run bundle:cpanel`.
2. In File Manager: upload the new `brandambassador-cpanel.tar.gz` to the application root and extract it, overwriting the files. `.env` is not in the bundle, so it stays.
3. **Run NPM Install** (only needed when packages changed, harmless otherwise), then **Restart**.

New database migrations run by themselves on the restart (`AUTO_SETUP=true`).
