import { z } from 'zod';
import { isValidEik, normalizeEik } from './eik.js';
import { eurToCents, percentToBp, qtyToMilli } from './money.js';
import { DELIVERY_METHODS, INVOICE_METHODS, LOCALES, ORDER_STATUSES, PAIR_STATUSES, REMINDER_STATUSES, UNITS } from './types.js';

/** Validation messages are i18n keys resolved by the web app (`validation.*`). */
export const V = {
  required: 'validation.required',
  email: 'validation.email',
  tooLong: 'validation.too_long',
  invalid: 'validation.invalid',
  date: 'validation.date',
  eik: 'validation.eik',
  phone: 'validation.phone',
  passwordMin: 'validation.password_min',
  loginId: 'validation.login_id',
  amount: 'validation.amount',
  percent: 'validation.percent',
  quantity: 'validation.quantity',
  itemsRequired: 'validation.items_required',
  priceRequired: 'validation.price_required',
} as const;

export const localeSchema = z.enum(LOCALES);
export const uuidSchema = z.uuid(V.invalid);

export const requiredText = (max = 200) => z.string(V.required).trim().min(1, V.required).max(max, V.tooLong);

/** Optional text: empty strings become null (stored as NULL). */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, V.tooLong)
    .nullish()
    .transform((v) => (v ? v : null));

export const emailSchema = z.string(V.required).trim().min(1, V.required).max(254, V.tooLong).toLowerCase().pipe(z.email(V.email));

export const optionalEmail = z
  .string()
  .trim()
  .max(254, V.tooLong)
  .toLowerCase()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.email().safeParse(v).success, V.email);

export const dateSchema = z
  .string(V.required)
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, V.date)
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), V.date);

export const optionalDate = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))), V.date);

export const eikSchema = z
  .string(V.required)
  .trim()
  .min(1, V.required)
  .transform(normalizeEik)
  .refine(isValidEik, V.eik);

export const phoneSchema = z
  .string(V.required)
  .trim()
  .min(1, V.required)
  .max(40, V.tooLong)
  .refine((v) => /^\+?[\d\s()/-]{6,}$/.test(v) && v.replace(/\D/g, '').length >= 6, V.phone);

/** A euro amount (number or numeric string with a comma or a dot) → cents. */
const euroNumber = z.preprocess((v) => (typeof v === 'string' ? Number(v.replace(',', '.').trim() || NaN) : v), z.number(V.amount).finite(V.amount));
export const centsSchema = euroNumber.pipe(z.number().min(0, V.amount).max(100_000_000, V.amount)).transform(eurToCents);
export const positiveCentsSchema = euroNumber.pipe(z.number().gt(0, V.amount).max(100_000_000, V.amount)).transform(eurToCents);
export const percentBpSchema = euroNumber.pipe(z.number().min(0, V.percent).max(100, V.percent)).transform(percentToBp);
export const quantityMilliSchema = euroNumber.pipe(z.number().gt(0, V.quantity).max(10_000_000, V.quantity)).transform(qtyToMilli);

/** A staff username (3-50 chars) or an email. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,49}$/;
export const loginIdSchema = z
  .string(V.required)
  .trim()
  .min(1, V.required)
  .max(254, V.tooLong)
  .toLowerCase()
  .refine((v) => USERNAME_RE.test(v) || z.email().safeParse(v).success, V.loginId);

export const passwordSchema = z.string(V.required).min(10, V.passwordMin).max(128, V.tooLong);

export type FieldErrors = Record<string, string>;

/** Flattens zod issues to `{ "path.to.field": "validation.key" }` (first issue per field wins). */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const i of error.issues) {
    const key = i.path.map(String).join('.') || '_';
    out[key] ??= i.message.startsWith('validation.') ? i.message : V.invalid;
  }
  return out;
}

// ─── Auth ───

export const loginSchema = z.object({ login: loginIdSchema, password: z.string(V.required).min(1, V.required).max(128, V.tooLong) });
export const changePasswordSchema = z.object({ current: z.string(V.required).min(1, V.required), next: passwordSchema });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const setPasswordSchema = z.object({ token: z.string().min(16).max(200), password: passwordSchema });
export const localeInputSchema = z.object({ locale: localeSchema });

// ─── Parties ───

const party = {
  name: requiredText(200),
  eik: eikSchema,
  phone: phoneSchema,
  email: emailSchema,
  address: requiredText(500),
  contact_person: optionalText(200),
  notes: optionalText(4000),
  active: z.boolean().default(true),
};

export const producerInputSchema = z.object({
  ...party,
  /** null: the default from the settings (10% unless changed). */
  commission_percent: percentBpSchema.nullish().transform((v) => v ?? null),
  default_vat_percent: percentBpSchema.default(20 * 100),
  delivery_method: z.enum(DELIVERY_METHODS).default('own_transport'),
  delivery_note: optionalText(1000),
  invoice_method: z.enum(INVOICE_METHODS).default('email'),
  invoice_note: optionalText(1000),
  contract_number: optionalText(100),
  contract_signed_on: optionalDate,
});
export type ProducerInput = z.output<typeof producerInputSchema>;

export const merchantInputSchema = z.object({
  ...party,
  invoice_method: z.enum(INVOICE_METHODS).default('email'),
  invoice_email: optionalEmail,
  invoice_note: optionalText(1000),
  delivery_note: optionalText(1000),
});
export type MerchantInput = z.output<typeof merchantInputSchema>;

/** What producers and merchants may change about themselves. Name, ЕИК and commission are the admin's. */
export const producerProfileSchema = z.object({
  phone: phoneSchema,
  address: requiredText(500),
  contact_person: optionalText(200),
  delivery_method: z.enum(DELIVERY_METHODS),
  delivery_note: optionalText(1000),
  invoice_method: z.enum(INVOICE_METHODS),
  invoice_note: optionalText(1000),
  default_vat_percent: percentBpSchema,
});
export const merchantProfileSchema = z.object({
  phone: phoneSchema,
  address: requiredText(500),
  contact_person: optionalText(200),
  invoice_method: z.enum(INVOICE_METHODS),
  invoice_email: optionalEmail,
  invoice_note: optionalText(1000),
  delivery_note: optionalText(1000),
});

/** Приложение № 1: the special terms for one producer and one buyer. */
export const pairInputSchema = z.object({
  merchant_id: uuidSchema,
  status: z.enum(PAIR_STATUSES).default('attracted'),
  /** null: the producer's rate. */
  commission_percent: percentBpSchema.nullish().transform((v) => v ?? null),
  introduced_on: optionalDate,
  introduced_how: optionalText(500),
  territory: optionalText(300),
  products_note: optionalText(1000),
  /** art. 17(3)-(4): days without an order after which the buyer is no longer "active". */
  active_period_days: z.coerce.number(V.invalid).int(V.invalid).min(1, V.invalid).max(730, V.invalid).default(30),
  released_on: optionalDate,
  release_fee: centsSchema.nullish().transform((v) => v ?? null),
  special_terms: optionalText(4000),
});
export type PairInput = z.output<typeof pairInputSchema>;

// ─── Goods ───

export const goodInputSchema = z.object({
  name_bg: requiredText(200),
  name_en: optionalText(200),
  sku: optionalText(80),
  unit: z.enum(UNITS).default('pcs'),
  /** Net price per unit without VAT, in euro. */
  price: centsSchema,
  vat_percent: percentBpSchema.default(20 * 100),
  description: optionalText(2000),
  active: z.boolean().default(true),
});
export type GoodInput = z.output<typeof goodInputSchema>;

// ─── Orders ───

export const orderCreateSchema = z.object({
  producer_id: uuidSchema.optional(),
  merchant_id: uuidSchema.optional(),
  order_date: optionalDate,
  merchant_ref: optionalText(100),
  requested_delivery_on: optionalDate,
  note: optionalText(2000),
  items: z
    .array(z.object({ good_id: uuidSchema, quantity: quantityMilliSchema }))
    .min(1, V.itemsRequired)
    .max(200, V.tooLong),
});
export type OrderCreateInput = z.output<typeof orderCreateSchema>;

/** Admin only: lines, prices, commission and returns of an existing order. */
export const orderAdminEditSchema = z.object({
  items: z
    .array(
      z.object({
        id: uuidSchema.optional(),
        good_id: uuidSchema,
        quantity: quantityMilliSchema,
        unit_price: centsSchema,
        vat_percent: percentBpSchema,
      }),
    )
    .min(1, V.itemsRequired)
    .max(200, V.tooLong),
  commission_percent: percentBpSchema,
  returned_net: centsSchema.default(0),
  returned_note: optionalText(1000),
  /** Also store the new prices as the agreed prices for this producer and merchant. */
  update_agreed_prices: z.boolean().default(true),
});
export type OrderAdminEditInput = z.output<typeof orderAdminEditSchema>;

export const orderDeliverySchema = z.object({
  delivery_method: z.enum(DELIVERY_METHODS),
  delivery_note: optionalText(1000),
  planned_delivery_on: optionalDate,
  delivered_on: optionalDate,
});

export const orderInvoiceSchema = z.object({
  invoice_number: optionalText(50),
  invoice_date: optionalDate,
  invoice_method: z.enum(INVOICE_METHODS),
  invoice_note: optionalText(1000),
});

export const orderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  reason: optionalText(1000),
});

export const orderReturnSchema = z.object({
  returned_net: centsSchema,
  returned_note: optionalText(1000),
});

export const paymentInputSchema = z.object({
  amount: positiveCentsSchema,
  paid_on: dateSchema,
  note: optionalText(500),
});

export const orderListQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  status: z.enum(ORDER_STATUSES).optional(),
  producer_id: uuidSchema.optional(),
  merchant_id: uuidSchema.optional(),
  from: optionalDate,
  to: optionalDate,
});

// ─── Price change requests ───

export const priceRequestSchema = z.object({
  good_id: uuidSchema,
  /** The merchant whose agreed price should change (a merchant's own request fills it in). */
  merchant_id: uuidSchema.optional(),
  order_id: uuidSchema.optional(),
  proposed_price: centsSchema.nullish().transform((v) => v ?? null),
  description: optionalText(2000),
});

export const resolveRequestSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    new_price: centsSchema.nullish().transform((v) => v ?? null),
    /** Also change the price on this pair's orders that are not delivered yet. */
    apply_to_open_orders: z.boolean().default(true),
    response: optionalText(2000),
  })
  .refine((v) => v.decision === 'rejected' || v.new_price !== null, { path: ['new_price'], message: V.priceRequired });

export const agreedPriceSchema = z.object({
  price: centsSchema,
  apply_to_open_orders: z.boolean().default(false),
});

// ─── Reminders ───

export const reminderInputSchema = z.object({
  merchant_id: uuidSchema,
  producer_id: uuidSchema.nullish().transform((v) => v ?? null),
  due_on: dateSchema,
  message: optionalText(2000),
  /** Also email again this many days before the due date (0 = only on the day). */
  remind_days_before: z.coerce.number(V.invalid).int(V.invalid).min(0, V.invalid).max(60, V.invalid).default(3),
  send_now: z.boolean().default(true),
});
export const reminderStatusSchema = z.object({ status: z.enum(REMINDER_STATUSES) });

// ─── Users and settings ───

export const userCreateSchema = z.object({
  email: emailSchema,
  name: optionalText(200),
  locale: localeSchema.default('bg'),
  /** Empty: the user gets an email with a link to choose a password. */
  password: z
    .string()
    .max(128, V.tooLong)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || v.length >= 10, V.passwordMin),
});

export const settingsInputSchema = z.object({
  default_commission_percent: percentBpSchema,
  notify_emails: z
    .string()
    .trim()
    .max(1000, V.tooLong)
    .default('')
    .transform((v) =>
      v
        .split(/[,;\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    )
    .refine((list) => list.every((e) => z.email().safeParse(e).success), V.email),
  reminder_days_before: z.coerce.number(V.invalid).int(V.invalid).min(0, V.invalid).max(60, V.invalid),
  company_name: optionalText(200),
  company_eik: optionalText(20),
  company_address: optionalText(500),
  company_phone: optionalText(40),
  company_email: optionalEmail,
});
export type SettingsInput = z.output<typeof settingsInputSchema>;

export const reportQuerySchema = z.object({
  from: optionalDate,
  to: optionalDate,
  producer_id: uuidSchema.optional(),
  merchant_id: uuidSchema.optional(),
});
