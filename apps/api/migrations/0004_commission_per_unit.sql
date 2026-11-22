-- The commission is either a percent of the net value or a fixed amount for each unit sold.
-- It is chosen at the same three levels as before: the producer, the producer-merchant pair, the order.

ALTER TABLE producers
  ADD COLUMN commission_type text NOT NULL DEFAULT 'percent' CHECK (commission_type IN ('percent', 'per_unit')),
  -- Euro cents per unit of quantity, used when the type is per_unit.
  ADD COLUMN commission_unit_cents bigint NOT NULL DEFAULT 0 CHECK (commission_unit_cents >= 0);

-- NULL type: the pair uses the producer's commission (type and amount).
ALTER TABLE producer_merchants
  ADD COLUMN commission_type text CHECK (commission_type IN ('percent', 'per_unit')),
  ADD COLUMN commission_unit_cents bigint CHECK (commission_unit_cents >= 0);
UPDATE producer_merchants SET commission_type = 'percent' WHERE commission_bp IS NOT NULL;

ALTER TABLE orders
  ADD COLUMN commission_type text NOT NULL DEFAULT 'percent' CHECK (commission_type IN ('percent', 'per_unit')),
  ADD COLUMN commission_unit_cents bigint NOT NULL DEFAULT 0 CHECK (commission_unit_cents >= 0);
