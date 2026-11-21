export const LOCALES = ['bg', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Who is signed in. Producers and merchants see only their own data; the admin sees everything. */
export const ROLES = ['admin', 'producer', 'merchant'] as const;
export type Role = (typeof ROLES)[number];

/**
 * new → confirmed (the producer accepted it and planned the delivery) → delivered.
 * cancelled at any point before delivery.
 */
export const ORDER_STATUSES = ['new', 'confirmed', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** How the producer delivers (contract art. 14: delivery is the producer's job). */
export const DELIVERY_METHODS = ['own_transport', 'courier', 'pickup', 'other'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

/** How invoices travel: the producer sends them one way, the merchant receives them one way. */
export const INVOICE_METHODS = ['email', 'with_delivery', 'post', 'e_invoice', 'other'] as const;
export type InvoiceMethod = (typeof INVOICE_METHODS)[number];

export const UNITS = ['pcs', 'kg', 'l', 'box', 'pack', 'pallet'] as const;
export type Unit = (typeof UNITS)[number];

/**
 * A producer-merchant relationship (Приложение № 1):
 *  - attracted: a buyer I brought (art. 5) - commission is due;
 *  - pre_existing: the producer showed the buyer was already its client (art. 4(3), 5(4)) - no commission;
 *  - released: future commission bought out with the one-off fee (art. 9) - no commission on later orders.
 */
export const PAIR_STATUSES = ['attracted', 'pre_existing', 'released'] as const;
export type PairStatus = (typeof PAIR_STATUSES)[number];

export const REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * none: no commission on this order; awaiting_payment: the merchant has not paid yet, so nothing
 * is due (art. 8(1)); due: accrued, within the 5 working days; overdue: past them; settled: received in full.
 */
export const COMMISSION_STATUSES = ['none', 'awaiting_payment', 'due', 'overdue', 'settled'] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const REMINDER_STATUSES = ['open', 'done', 'cancelled'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

/** In-app notification types; texts are `notifications.<type>` in the web messages and in the email templates. */
export const NOTIFICATION_TYPES = [
  'order_created',
  'order_confirmed',
  'order_delivered',
  'order_cancelled',
  'order_changed',
  'payment_recorded',
  'commission_received',
  'request_created',
  'request_resolved',
  'reminder',
  'contract_notice',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** The contract's defaults (Договор за търговско посредничество и представителство). */
export const CONTRACT = {
  /** art. 7(2): 10% of each delivery */
  defaultCommissionBp: 1000,
  /** art. 8(3): commission is paid within 5 working days of the merchant's payment. */
  commissionDueWorkingDays: 5,
  /** art. 17(3): a buyer with an order in the last 30 days is "active". */
  activeBuyerDays: 30,
  /** art. 9(2): release fee = 100% of the first deal, at least 500 €. */
  releaseFeeMinCents: 50_000,
  /** art. 17(2): early termination = 10% of the buyer's total, at least 500 € per active buyer. */
  terminationBp: 1000,
  terminationMinCents: 50_000,
  /** art. 16(2): concealment = 10% of the last 12 months, at least 1000 €. */
  concealmentBp: 1000,
  concealmentMinCents: 100_000,
  /** art. 19: one year, renewed automatically unless refused 30 days before the end. */
  termMonths: 12,
  noticeDays: 30,
  /** art. 11(3): documents within 5 working days of a request. */
  documentsWorkingDays: 5,
} as const;
