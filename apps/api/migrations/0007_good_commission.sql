-- A fixed commission per unit can be set on a good. It wins over the producer's commission for that
-- good; it does not apply when the merchant has its own terms with the producer, or carries no commission.
ALTER TABLE goods ADD COLUMN commission_unit_cents bigint CHECK (commission_unit_cents >= 0);

-- Snapshot on the order line. NULL: the line follows the order's commission (percent or per unit).
ALTER TABLE order_items ADD COLUMN commission_unit_cents bigint CHECK (commission_unit_cents >= 0);
