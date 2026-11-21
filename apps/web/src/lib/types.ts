import type { CommissionStatus, OrderCalc, OrderStatus, PaymentStatus, RequestStatus, Role } from '@ba/shared';

export interface Me {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  producer_id: string | null;
  merchant_id: string | null;
  locale: 'bg' | 'en';
}

/** A merchant gets the totals without the commission fields. */
export type Calc = Partial<OrderCalc> & Pick<OrderCalc, 'netCents' | 'vatCents' | 'grossCents' | 'returnedNetCents' | 'baseNetCents' | 'payableGrossCents' | 'paidCents' | 'paymentStatus'>;

export interface OrderListRow {
  id: string;
  number: number;
  producer_id: string;
  merchant_id: string;
  producer_name: string;
  merchant_name: string;
  status: OrderStatus;
  order_date: string;
  merchant_ref: string | null;
  invoice_number: string | null;
  planned_delivery_on: string | null;
  delivered_on: string | null;
  commission_bp?: number;
  calc: Calc;
}

export interface OrderItem {
  id: string;
  good_id: string | null;
  name_bg: string;
  name_en: string | null;
  sku: string | null;
  unit: string;
  quantity_milli: number;
  unit_price_cents: number;
  vat_bp: number;
  good_available: boolean | null;
}

export interface Payment {
  id: string;
  amount_cents: number;
  paid_on: string;
  note: string | null;
  created_at: string;
}

export interface OrderEvent {
  id: number;
  type: string;
  role: Role;
  data: Record<string, unknown>;
  created_at: string;
  user_email: string | null;
  user_name: string | null;
}

export interface PriceRequest {
  id: string;
  number: number;
  good_id: string;
  good_name: string;
  good_name_en?: string | null;
  unit?: string;
  producer_id?: string;
  merchant_id?: string;
  producer_name?: string;
  merchant_name?: string;
  order_id?: string | null;
  order_number?: number | null;
  status: RequestStatus;
  current_price_cents: number;
  proposed_price_cents: number | null;
  new_price_cents: number | null;
  description: string | null;
  response: string | null;
  requested_by_role: Role;
  requested_by_email?: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface OrderDetail extends OrderListRow {
  requested_delivery_on: string | null;
  note: string | null;
  created_by_role: Role;
  delivery_method: string;
  delivery_note: string | null;
  invoice_date: string | null;
  invoice_method: string;
  invoice_note: string | null;
  invoice_receive_method: string;
  returned_net_cents: number;
  returned_note: string | null;
  cancel_reason: string | null;
  updated_at: string;
  items: OrderItem[];
  payments: Payment[];
  commission_payments?: Payment[];
  events: OrderEvent[];
  requests: PriceRequest[];
  producer: { id: string; name: string; eik: string; phone: string; email: string; address: string; contact_person: string | null };
  merchant: { id: string; name: string; eik: string; phone: string; email: string; address: string; contact_person: string | null; invoice_email: string | null; delivery_note: string | null };
}

export interface Good {
  id: string;
  producer_id: string;
  producer_name?: string;
  name_bg: string;
  name_en: string | null;
  sku: string | null;
  unit: string;
  price_cents: number;
  vat_bp: number;
  description: string | null;
  active: boolean;
  my_price_cents?: number;
  price_locked?: boolean;
  merchants_count?: number;
  sold_milli?: number;
}

export interface AgreedPrice {
  id: string;
  good_id: string;
  merchant_id: string;
  producer_id: string;
  price_cents: number;
  list_price_cents: number;
  vat_bp: number;
  name_bg: string;
  name_en: string | null;
  unit: string;
  producer_name: string;
  merchant_name: string;
  quantity_milli: number;
  last_order_on: string | null;
  updated_at: string;
}

export interface PartyStats {
  orders: number;
  net_cents: number;
  commission_cents: number;
  received_cents: number;
  last_order_on: string | null;
}

export interface Producer {
  id: string;
  name: string;
  eik: string;
  phone: string;
  email: string;
  address: string;
  contact_person: string | null;
  active: boolean;
  delivery_method: string;
  delivery_note: string | null;
  invoice_method: string;
  invoice_note: string | null;
  default_vat_bp: number;
  notes?: string | null;
  commission_bp?: number;
  contract_number?: string | null;
  contract_signed_on?: string | null;
  contract?: { end: string; notice: string } | null;
  stats?: PartyStats;
  goods_count?: number;
  merchants_count?: number;
  users_count?: number;
  my_orders?: number;
  my_last_order_on?: string | null;
}

export interface Merchant {
  id: string;
  name: string;
  eik: string;
  phone: string;
  email: string;
  address: string;
  contact_person: string | null;
  active: boolean;
  invoice_method: string;
  invoice_email: string | null;
  invoice_note: string | null;
  delivery_note: string | null;
  notes?: string | null;
  stats?: PartyStats;
  producers_count?: number;
  users_count?: number;
  open_reminders?: number;
}

export interface Pair {
  id: string;
  producer_id: string;
  merchant_id: string;
  producer_name: string;
  merchant_name: string;
  merchant_eik: string;
  merchant_address: string;
  status: 'attracted' | 'pre_existing' | 'released';
  commission_bp: number | null;
  producer_commission_bp: number;
  effective_commission_bp: number;
  introduced_on: string | null;
  introduced_how: string | null;
  territory: string | null;
  products_note: string | null;
  active_period_days: number;
  released_on: string | null;
  release_fee_cents: number | null;
  special_terms: string | null;
  last_order_on: string | null;
  orders: number;
  total_net_cents: number;
  first_net_cents: number | null;
  active_buyer: boolean;
}

export interface Reminder {
  id: string;
  merchant_id: string;
  merchant_name: string;
  producer_id: string | null;
  producer_name: string | null;
  due_on: string;
  message: string | null;
  remind_days_before: number;
  status: 'open' | 'done' | 'cancelled';
  last_sent_at: string | null;
  created_at: string;
}

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  locale: 'bg' | 'en';
  active: boolean;
  has_password: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  type: string;
  data: Record<string, unknown>;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export type { CommissionStatus, OrderStatus, PaymentStatus, RequestStatus, Role };
