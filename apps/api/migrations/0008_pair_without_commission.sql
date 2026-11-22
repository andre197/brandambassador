-- Merchants have nothing to do with the commission: it is set on the producer, on a good, or by the
-- admin on one order. The producer-merchant terms keep only whether commission applies at all
-- (status: attracted, or pre-existing / released, which carry none).
ALTER TABLE producer_merchants
  DROP COLUMN commission_type,
  DROP COLUMN commission_bp,
  DROP COLUMN commission_unit_cents;
