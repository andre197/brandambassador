-- Line totals are now computed from the price incl. VAT: the price incl. VAT per unit (rounded to the
-- cent) times the quantity gives the total incl. VAT; the total excl. VAT is taken out of it
-- (gross / (1 + VAT)). Same rounding as lineAmounts() in packages/shared/src/money.ts.
ALTER TABLE order_items DROP COLUMN line_net_cents, DROP COLUMN line_gross_cents;

ALTER TABLE order_items
  ADD COLUMN line_gross_cents bigint GENERATED ALWAYS AS (
    round(quantity_milli * (unit_price_cents + round(unit_price_cents * vat_bp / 10000.0)) / 1000.0)::bigint
  ) STORED,
  ADD COLUMN line_net_cents bigint GENERATED ALWAYS AS (
    round(round(quantity_milli * (unit_price_cents + round(unit_price_cents * vat_bp / 10000.0)) / 1000.0) * 10000.0 / (10000 + vat_bp))::bigint
  ) STORED;

-- The cached order totals follow: net and gross are the sums of the lines. (The commission cache is
-- refreshed by the API the next time an order changes; a plain percent order is refreshed here.)
UPDATE orders o SET net_cents = x.net, gross_cents = x.gross
  FROM (SELECT order_id, sum(line_net_cents) AS net, sum(line_gross_cents) AS gross FROM order_items GROUP BY order_id) x
 WHERE x.order_id = o.id;
UPDATE orders o SET commission_cents = round((o.net_cents - o.returned_net_cents) * o.commission_bp / 10000.0)::bigint
 WHERE o.commission_type = 'percent' AND o.status <> 'cancelled'
   AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.commission_unit_cents IS NOT NULL);
