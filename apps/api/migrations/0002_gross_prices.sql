-- Prices with VAT stored next to the net prices, so every table reads them instead of computing them.
-- They are generated columns: Postgres fills them on every insert and update, so they can never drift
-- from the net price and the VAT rate. Rounding matches calculateOrder() in packages/shared/src/money.ts
-- (half away from zero, which is the same as Math.round for amounts that are never negative).

-- Goods: the producer's list price incl. VAT.
ALTER TABLE goods
  ADD COLUMN price_gross_cents bigint GENERATED ALWAYS AS (price_cents + round(price_cents * vat_bp / 10000.0)::bigint) STORED;

-- Agreed prices: VAT is the good's rate. It is copied here (and kept in sync by the triggers below)
-- because a generated column can only use columns of its own row.
ALTER TABLE agreed_prices ADD COLUMN vat_bp int;
UPDATE agreed_prices ap SET vat_bp = g.vat_bp FROM goods g WHERE g.id = ap.good_id;
ALTER TABLE agreed_prices ALTER COLUMN vat_bp SET NOT NULL;
ALTER TABLE agreed_prices
  ADD COLUMN price_gross_cents bigint GENERATED ALWAYS AS (price_cents + round(price_cents * vat_bp / 10000.0)::bigint) STORED;

CREATE FUNCTION agreed_prices_vat_from_good() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT vat_bp INTO NEW.vat_bp FROM goods WHERE id = NEW.good_id;
  RETURN NEW;
END $$;
CREATE TRIGGER agreed_prices_vat BEFORE INSERT OR UPDATE OF good_id ON agreed_prices
  FOR EACH ROW EXECUTE FUNCTION agreed_prices_vat_from_good();

CREATE FUNCTION goods_vat_to_agreed_prices() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE agreed_prices SET vat_bp = NEW.vat_bp WHERE good_id = NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER goods_vat_sync AFTER UPDATE OF vat_bp ON goods
  FOR EACH ROW WHEN (OLD.vat_bp IS DISTINCT FROM NEW.vat_bp) EXECUTE FUNCTION goods_vat_to_agreed_prices();

-- Order lines: unit price incl. VAT, and the line totals excl. and incl. VAT. The line VAT is taken
-- from the line net (not from the unit price), exactly as calculateOrder() does.
ALTER TABLE order_items
  ADD COLUMN unit_price_gross_cents bigint GENERATED ALWAYS AS (unit_price_cents + round(unit_price_cents * vat_bp / 10000.0)::bigint) STORED,
  ADD COLUMN line_net_cents bigint GENERATED ALWAYS AS (round(quantity_milli * unit_price_cents / 1000.0)::bigint) STORED,
  ADD COLUMN line_gross_cents bigint GENERATED ALWAYS AS (
    round(quantity_milli * unit_price_cents / 1000.0)::bigint
    + round(round(quantity_milli * unit_price_cents / 1000.0) * vat_bp / 10000.0)::bigint
  ) STORED;
