# Brand Ambassador

Owner: Andrey. Repo: https://github.com/andre197/brandambassador. Local path: `D:\brandambasador` (Windows). Sister projects with the same stack and conventions: `D:\OpasenChar`, `D:\opasencharcoffee`.

See README.md for setup and roles, and docs/CONTRACT-RULES.md for how the contract maps to the code.

## Decisions

- Three roles in one `users` table: `admin`, `producer` (linked to `producers`), `merchant` (linked to `merchants`). Every API service narrows data by `Actor`; merchants never receive commission fields (`stripCommission`, `merchantCalc`).
- Bilingual: Bulgarian is the default, English second. The language comes from the `locale` cookie, which is set at sign-in from `users.locale` and by the switcher. There are no URL prefixes. Emails go out in each recipient's language.
- Money is stored in euro cents, percentages in basis points, quantities in thousandths. `calculateOrder()` in packages/shared is the only formula for totals and commission. The API caches `net_cents`, `gross_cents` and `commission_cents` on `orders` through `OrderService.recompute()`.
- Prices: a good's first order with a merchant writes `agreed_prices`. After that, only the admin changes it (order edit, agreed-price edit, or approving a `price_requests` row).
- Notifications: `NotificationService.notify()` runs inside the same transaction as the change. It writes an in-app row and an outbox job, which fans out one email per recipient.
- Contract files (`contracts/`, `*.docx`) stay out of git.
- Tailwind is pinned to 4.3.3: later versions pull an ESM-only magic-string that breaks on Node 20.16. `cookie` is pinned to v1 through npm `overrides` for the same reason.

## Conventions

- No em dashes (U+2014): use a plain hyphen.
- No hardcoded user-facing strings: put them in `apps/web/messages/{bg,en}.json` (keep the keys identical) and in the email templates in `apps/api/src/integrations/email/templates.ts`.
- API layering: routes (zod validation) → services (logic and SQL) → integrations (email).
- Do not invent legal rules. The contract figures shown are marked as indicative.
