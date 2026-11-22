-- One order is for the company (the merchant); each line says which of its shops it is for,
-- e.g. 200 eggs for shop 1 and 300 eggs for shop 2 in the same order.
ALTER TABLE order_items
  ADD COLUMN shop_id uuid REFERENCES merchant_shops(id) ON DELETE SET NULL,
  -- Copied, so the line keeps them if the shop changes later. No shop: the merchant's own address.
  ADD COLUMN shop_alias text,
  ADD COLUMN shop_address text;
CREATE INDEX order_items_shop_idx ON order_items (shop_id);

UPDATE order_items oi SET shop_id = o.shop_id, shop_alias = o.shop_alias, shop_address = o.shop_address
  FROM orders o WHERE o.id = oi.order_id AND o.shop_alias IS NOT NULL;

DROP INDEX orders_shop_idx;
ALTER TABLE orders DROP COLUMN shop_id, DROP COLUMN shop_alias, DROP COLUMN shop_address;
