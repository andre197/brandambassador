-- A merchant can be marked as charged 0% VAT: its new orders get VAT 0 on every line
-- (order_items.vat_bp is a snapshot, so existing orders keep the VAT they were made with).
ALTER TABLE merchants ADD COLUMN zero_vat boolean NOT NULL DEFAULT false;
