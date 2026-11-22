-- A merchant (one company, one ЕИК) can have several shops, each with its own alias and address.
CREATE TABLE merchant_shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  alias text NOT NULL,
  address text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, alias)
);
CREATE INDEX merchant_shops_merchant_idx ON merchant_shops (merchant_id);

-- The shop an order is for. The alias and address are copied, so the order keeps them if the shop
-- changes later. No shop: the order is for the merchant's own address.
ALTER TABLE orders
  ADD COLUMN shop_id uuid REFERENCES merchant_shops(id) ON DELETE SET NULL,
  ADD COLUMN shop_alias text,
  ADD COLUMN shop_address text;
CREATE INDEX orders_shop_idx ON orders (shop_id);
