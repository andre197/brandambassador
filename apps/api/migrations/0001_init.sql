-- Brand Ambassador: producers, merchants (the buyers I bring them), goods, orders, my commission.
-- Money: integer euro cents. Percentages: basis points (1000 = 10%). Quantities: thousandths.

-- ─── Settings ───

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (key, value) VALUES ('app', '{"default_commission_bp": 1000, "reminder_days_before": 3, "notify_emails": []}'::jsonb);

-- ─── Parties ───

CREATE TABLE producers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  eik text NOT NULL UNIQUE,
  phone text NOT NULL,
  email text NOT NULL,
  address text NOT NULL,
  contact_person text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  -- My commission for this producer (art. 7(2): 10% unless agreed otherwise).
  commission_bp int NOT NULL DEFAULT 1000 CHECK (commission_bp BETWEEN 0 AND 10000),
  default_vat_bp int NOT NULL DEFAULT 2000 CHECK (default_vat_bp BETWEEN 0 AND 10000),
  -- How the producer delivers and sends invoices (defaults for its orders).
  delivery_method text NOT NULL DEFAULT 'own_transport',
  delivery_note text,
  invoice_method text NOT NULL DEFAULT 'email',
  invoice_note text,
  contract_number text,
  contract_signed_on date,
  -- The yearly contract-notice reminder already sent for this end date.
  contract_notice_sent_for date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  eik text NOT NULL UNIQUE,
  phone text NOT NULL,
  email text NOT NULL,
  address text NOT NULL,
  contact_person text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  -- How the merchant receives invoices.
  invoice_method text NOT NULL DEFAULT 'email',
  invoice_email text,
  invoice_note text,
  -- Receiving hours, ramp, who signs for the goods…
  delivery_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Приложение № 1: one producer and one buyer.
CREATE TABLE producer_merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id uuid NOT NULL REFERENCES producers(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'attracted' CHECK (status IN ('attracted', 'pre_existing', 'released')),
  -- NULL: the producer's rate.
  commission_bp int CHECK (commission_bp BETWEEN 0 AND 10000),
  introduced_on date,
  introduced_how text,
  territory text,
  products_note text,
  active_period_days int NOT NULL DEFAULT 30,
  released_on date,
  release_fee_cents bigint,
  special_terms text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (producer_id, merchant_id)
);
CREATE INDEX producer_merchants_merchant_idx ON producer_merchants (merchant_id);

-- ─── Users ───

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The login: an email (producers, merchants) or a username (the admin).
  email text NOT NULL UNIQUE,
  name text,
  role text NOT NULL CHECK (role IN ('admin', 'producer', 'merchant')),
  producer_id uuid REFERENCES producers(id) ON DELETE CASCADE,
  merchant_id uuid REFERENCES merchants(id) ON DELETE CASCADE,
  password_hash text,
  locale text NOT NULL DEFAULT 'bg',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  CHECK ((role = 'admin' AND producer_id IS NULL AND merchant_id IS NULL)
      OR (role = 'producer' AND producer_id IS NOT NULL AND merchant_id IS NULL)
      OR (role = 'merchant' AND merchant_id IS NOT NULL AND producer_id IS NULL))
);
CREATE INDEX users_producer_idx ON users (producer_id);
CREATE INDEX users_merchant_idx ON users (merchant_id);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ip_hash bytea,
  user_agent text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Invitation and password-reset links (single use).
CREATE TABLE password_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('invite', 'reset')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Goods and prices ───

CREATE TABLE goods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id uuid NOT NULL REFERENCES producers(id) ON DELETE CASCADE,
  name_bg text NOT NULL,
  name_en text,
  sku text,
  unit text NOT NULL DEFAULT 'pcs',
  -- The producer's list price: net per unit, without VAT.
  price_cents bigint NOT NULL CHECK (price_cents >= 0),
  vat_bp int NOT NULL DEFAULT 2000,
  description text,
  active boolean NOT NULL DEFAULT true,
  -- Deleted by the producer while orders still refer to it: hidden, kept for history.
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goods_producer_idx ON goods (producer_id);

-- Once a good has been in an order between a producer and a merchant, its price for that merchant
-- is fixed here and only the admin can change it.
CREATE TABLE agreed_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  good_id uuid NOT NULL REFERENCES goods(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  price_cents bigint NOT NULL CHECK (price_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (good_id, merchant_id)
);
CREATE INDEX agreed_prices_merchant_idx ON agreed_prices (merchant_id);

-- ─── Orders ───

CREATE SEQUENCE order_number_seq START 1001;

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigint NOT NULL UNIQUE DEFAULT nextval('order_number_seq'),
  producer_id uuid NOT NULL REFERENCES producers(id) ON DELETE RESTRICT,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'delivered', 'cancelled')),
  order_date date NOT NULL,
  -- The merchant's own order number.
  merchant_ref text,
  requested_delivery_on date,
  note text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by_role text NOT NULL,
  -- Delivery (the producer's).
  delivery_method text NOT NULL,
  delivery_note text,
  planned_delivery_on date,
  delivered_on date,
  -- Invoice: how the producer sends it and how the merchant receives it (snapshots, editable).
  invoice_number text,
  invoice_date date,
  invoice_method text NOT NULL,
  invoice_note text,
  invoice_receive_method text NOT NULL,
  -- Commission for this order (snapshot of the pair or producer rate; the admin can change it).
  commission_bp int NOT NULL CHECK (commission_bp BETWEEN 0 AND 10000),
  returned_net_cents bigint NOT NULL DEFAULT 0 CHECK (returned_net_cents >= 0),
  returned_note text,
  cancel_reason text,
  -- Cached totals for lists and reports (recomputed by the API with calculateOrder()).
  net_cents bigint NOT NULL DEFAULT 0,
  gross_cents bigint NOT NULL DEFAULT 0,
  commission_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_producer_idx ON orders (producer_id, order_date DESC);
CREATE INDEX orders_merchant_idx ON orders (merchant_id, order_date DESC);
CREATE INDEX orders_status_idx ON orders (status);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  good_id uuid REFERENCES goods(id) ON DELETE SET NULL,
  -- Snapshot, so history survives changes to the good.
  name_bg text NOT NULL,
  name_en text,
  sku text,
  unit text NOT NULL,
  quantity_milli bigint NOT NULL CHECK (quantity_milli > 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  vat_bp int NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_good_idx ON order_items (good_id);

-- What the merchant paid the producer (art. 8: commission accrues on these).
CREATE TABLE order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  paid_on date NOT NULL,
  note text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_payments_order_idx ON order_payments (order_id);

-- What the producer paid me for an order.
CREATE TABLE commission_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  paid_on date NOT NULL,
  note text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commission_payments_order_idx ON commission_payments (order_id);

-- Who changed what on an order.
CREATE TABLE order_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  role text NOT NULL,
  type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id, id);

-- ─── Price change requests ───

CREATE TABLE price_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  good_id uuid NOT NULL REFERENCES goods(id) ON DELETE CASCADE,
  producer_id uuid NOT NULL REFERENCES producers(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_by_role text NOT NULL,
  current_price_cents bigint NOT NULL,
  proposed_price_cents bigint,
  description text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  new_price_cents bigint,
  response text,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_requests_status_idx ON price_requests (status, created_at DESC);

-- ─── Order reminders to merchants ───

CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  producer_id uuid REFERENCES producers(id) ON DELETE CASCADE,
  due_on date NOT NULL,
  message text,
  remind_days_before int NOT NULL DEFAULT 3,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  -- Automatic emails already sent: 'before' (N days ahead), 'due' (on the day).
  sent_before_at timestamptz,
  sent_due_at timestamptz,
  last_sent_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reminders_due_idx ON reminders (status, due_on);
CREATE INDEX reminders_merchant_idx ON reminders (merchant_id);

-- ─── Notifications ───

-- In-app notices for a party: the admin (both ids NULL), a producer or a merchant.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience text NOT NULL CHECK (audience IN ('admin', 'producer', 'merchant')),
  producer_id uuid REFERENCES producers(id) ON DELETE CASCADE,
  merchant_id uuid REFERENCES merchants(id) ON DELETE CASCADE,
  type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_admin_idx ON notifications (audience, created_at DESC);
CREATE INDEX notifications_producer_idx ON notifications (producer_id, created_at DESC);
CREATE INDEX notifications_merchant_idx ON notifications (merchant_id, created_at DESC);

-- ─── Outbox ───

CREATE TABLE outbox_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'dead')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 8,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  dedupe_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_due_idx ON outbox_jobs (status, run_at);
