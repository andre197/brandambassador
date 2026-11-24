# Brand Ambassador

Owner: Andrey. Repo: https://github.com/andre197/brandambassador. Local path: `D:\brandambasador` (Windows). Sister projects with the same stack and conventions: `D:\OpasenChar`, `D:\opasencharcoffee`.

See README.md for setup and roles, and docs/CONTRACT-RULES.md for how the contract maps to the code.

## Decisions

- Three roles in one `users` table: `admin`, `producer` (linked to `producers`), `merchant` (linked to `merchants`). Every API service narrows data by `Actor`; merchants never receive commission fields (`stripCommission`, `merchantCalc`).
- Bilingual: Bulgarian is the default, English second. The language comes from the `locale` cookie, which is set at sign-in from `users.locale` and by the switcher. There are no URL prefixes. Emails go out in each recipient's language.
- Money is stored in euro cents, percentages in basis points, quantities in thousandths. `calculateOrder()` in packages/shared is the only formula for totals and commission. The API caches `net_cents`, `gross_cents` and `commission_cents` on `orders` through `OrderService.recompute()`.
- Line totals are gross first: price incl. VAT per unit (rounded) x quantity = total incl. VAT; total excl. VAT = gross / (1 + VAT); VAT = the difference. `lineAmounts()` in packages/shared and the generated `order_items` columns (migration 0010) must stay identical.
- Prices incl. VAT are Postgres generated columns (migration 0002): `goods.price_gross_cents`, `agreed_prices.price_gross_cents` (its `vat_bp` is kept in sync with the good by triggers), `order_items.unit_price_gross_cents`, `line_net_cents`, `line_gross_cents`. Read them; do not compute VAT prices in the app.
- A merchant can be charged 0% VAT (`merchants.zero_vat`, migration 0012): its new order lines get `vat_bp = 0`, and the goods and agreed-price lists it sees show VAT 0. Existing orders keep their VAT (snapshot).
- Prices: a good's first order with a merchant writes `agreed_prices`. After that, only the admin changes it (order edit, agreed-price edit, or approving a `price_requests` row).
- Commission: `commission_type` is `percent` (uses `commission_bp`) or `per_unit` (uses `commission_unit_cents`) on `producers` and `orders` (snapshot). A good can have its own `commission_unit_cents`, copied to `order_items.commission_unit_cents`; it wins over the order's commission for that line. Merchants (`producer_merchants`) have no commission terms, only the status: pre-existing or released carry none. `effectiveCommission()` picks it; `calculateOrder()` computes it.
- Commission is owed in full once an order is delivered (`calculateOrder({ deliveredOn })`), due 5 Bulgarian working days later, whether or not the merchant paid. Merchant payments (`order_payments`) are recorded only by the producer and only drive the payment status.
- Price changes: a producer cannot change the price of a good linked with merchants (agreed price or order); it sends a `price_requests` row without `merchant_id`. Approving it updates only `goods.price_cents`, never agreed prices or orders.
- Shops: `merchant_shops` (alias, address). An order is for the company; each `order_items` line names its shop (required when the merchant has active shops), so one order can cover several shops. `order_items.shop_alias`/`shop_address` are snapshots. Orders carry no invoice fields; invoice preferences live on the profiles.
- Exports: `downloadCsv()` and `printTable()` (a print-ready page; the browser saves it as PDF) in `components/kit.tsx`.
- Notifications: `NotificationService.notify()` runs inside the same transaction as the change. It writes an in-app row and an outbox job, which fans out one email per recipient.
- Contract files (`contracts/`, `*.docx`) stay out of git.
- Tailwind is pinned to 4.3.3: later versions pull an ESM-only magic-string that breaks on Node 20.16. `cookie` is pinned to v1 through npm `overrides` for the same reason.

## Conventions

- No em dashes (U+2014): use a plain hyphen.
- No hardcoded user-facing strings: put them in `apps/web/messages/{bg,en}.json` (keep the keys identical) and in the email templates in `apps/api/src/integrations/email/templates.ts`.
- API layering: routes (zod validation) → services (logic and SQL) → integrations (email).
- Do not invent legal rules. The contract figures shown are marked as indicative.
