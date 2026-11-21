# Brand Ambassador

A bilingual (Bulgarian / English) platform for a commercial intermediary. **Producers** see where their goods are traded, at what price, how large the orders are, and the commission they owe. **Merchants** see the producers and place orders with them. **The admin** (the intermediary) manages everyone, gets notified of new orders, fixes prices, reminds merchants about orders they need to place, and sees what was received for each order.

The architecture follows `D:\OpasenChar` and `D:\opasencharcoffee`: an npm-workspaces monorepo with Fastify + PostgreSQL, Next.js + next-intl and Tailwind 4, an outbox worker for emails, and zod schemas shared between both apps.

## Stack

| Part | Technology |
|---|---|
| `apps/web` | Next.js 16 (App Router), next-intl (language from a cookie, Bulgarian by default), Tailwind CSS 4, self-hosted Inter font |
| `apps/api` | Fastify 5 + TypeScript, plain SQL migrations, server-side sessions (argon2id, httpOnly cookie), outbox worker (`src/worker.ts` or `cli/run-jobs.ts` from cron) |
| `packages/shared` | zod schemas, `calculateOrder()` (totals and commission), Bulgarian working-day calendar, ЕИК validation |
| Data | PostgreSQL 16. Money is stored as euro cents, percentages as basis points, quantities in thousandths |
| Tests | Vitest: unit tests in shared, integration tests in the API against a real Postgres |

## Quick start

Requirements: Node.js 20.12+ (22 LTS recommended) and Docker Desktop.

```bash
npm install
cp .env.example .env          # the defaults work locally
npm run db:up                 # Postgres on port 5434
npm run build:shared
npm run migrate
npm run seed:demo             # optional demo data (remove it with: npm run seed:demo -- --remove)
```

Then run each of these in its own terminal:

```bash
npm run dev:api               # http://localhost:4300
npm run dev:worker            # emails (printed to the terminal while EMAIL_PROVIDER=console), reminders, contract notices
npm run dev:web               # http://localhost:3300
```

Logins: **admin / admin** (created automatically in development only). After `seed:demo` there are also `producer@demo.bg` and `merchant@demo.bg` with the password `demo-password`.

## Who can do what

| | Admin | Producer | Merchant |
|---|---|---|---|
| Producers and merchants (name, ЕИК, phone, email, address) | add, change, delete | own profile (contact, delivery, invoicing) | own profile (contact, how it receives invoices) |
| Logins | creates them (with a password, or by sending an email invite) | - | - |
| Goods | all | add, change, delete its own | sees active goods at its own price |
| Orders | all, and can create one for anyone | records orders with its merchants, confirms, delivers, invoices, records the merchant's payments | places orders with any producer, cancels while the order is new |
| Price in an order | **only the admin** changes it (on the order, or as the agreed price) | asks for a change (with a description) | asks for a change (with a description) |
| Commission | sets the rate (default 10%, per producer, per buyer, per order) and records what was received | sees what it owes and the due dates | never sees it |
| Reminders "place an order by…" | creates them; the merchant is notified now, N days before and on the day | - | sees them, marks them done; an order closes them |
| Notifications (in-app and email) | new orders, payments, price requests, contract renewal | new orders, changes, request decisions, commission received | orders, reminders, request decisions |

**Price locking:** the first time a good goes into an order between a producer and a merchant, its price for that merchant is saved as the *agreed price*. Later orders use that price even if the producer changes its list price. Only the admin can change it, and can also apply the change to that merchant's undelivered orders.

**Commission:** the rules come from the contract. See [docs/CONTRACT-RULES.md](docs/CONTRACT-RULES.md).

## Commands

| Command | What it does |
|---|---|
| `npm test` | all tests (start the database first with `npm run db:up`) |
| `npm run typecheck` | type-checks every workspace |
| `npm run build` | production build |
| `npm run start:api` / `start:worker` / `start:web` | runs the built apps (`pm2 start ecosystem.config.cjs`) |
| `npm run create-admin -- --login you@example.com` | creates an admin or sets a new password |
| `npm run gmail-token` | gets an OAuth refresh token for sending through Gmail |

## Production

Set real environment variables (see `.env.example`: `SITE_URL` with https, `IP_HASH_SECRET`, SMTP, `ADMIN_LOGIN`/`ADMIN_PASSWORD` or `create-admin`). Then run `npm ci && npm run build && npm run migrate:prod` and start the three processes behind a reverse proxy. The proxy sends `/api/*` to port 4300 and everything else to 3300. If you use cron instead of the worker, run `node apps/api/dist/src/cli/run-jobs.js` every minute.
