import { addWorkingDays } from './calendar.js';
import { CONTRACT, type CommissionStatus, type CommissionType, type PaymentStatus } from './types.js';

/**
 * Money is integer euro cents, percentages are basis points (1000 = 10%), quantities are
 * thousandths (1500 = 1.5 kg), so every calculation is exact integer arithmetic.
 */

export const percentToBp = (percent: number) => Math.round(percent * 100);
export const bpToPercent = (bp: number) => bp / 100;
export const qtyToMilli = (qty: number) => Math.round(qty * 1000);
export const milliToQty = (milli: number) => milli / 1000;
export const eurToCents = (eur: number) => Math.round(eur * 100);

export const applyBp = (cents: number, bp: number) => Math.round((cents * bp) / 10_000);

/** The price of one unit incl. VAT, rounded to the cent. */
export const unitGrossCents = (unitPriceCents: number, vatBp: number) => unitPriceCents + applyBp(unitPriceCents, vatBp);

/**
 * The totals of one order line. The price incl. VAT per unit is multiplied by the quantity first; the
 * total excl. VAT is then taken out of that total (gross / (1 + VAT)), and the VAT is the difference.
 * The database computes order_items.line_gross_cents and line_net_cents the same way (migration 0010).
 */
export function lineAmounts(quantityMilli: number, unitPriceCents: number, vatBp: number) {
  const grossCents = Math.round((quantityMilli * unitGrossCents(unitPriceCents, vatBp)) / 1000);
  const netCents = Math.round((grossCents * 10_000) / (10_000 + vatBp));
  return { grossCents, netCents, vatCents: grossCents - netCents };
}

/** The total excl. VAT of one order line (see lineAmounts). */
export const lineNetCents = (quantityMilli: number, unitPriceCents: number, vatBp: number) => lineAmounts(quantityMilli, unitPriceCents, vatBp).netCents;

export interface CalcLine {
  quantityMilli: number;
  /** Net price per unit, without VAT. */
  unitPriceCents: number;
  vatBp: number;
  /** A fixed commission per unit for this line (from the good). Null or missing: the order's commission. */
  commissionUnitCents?: number | null;
}

export interface CalcInput {
  lines: CalcLine[];
  /** Net value (without VAT) of returned or credited goods (art. 10). */
  returnedNetCents?: number;
  /** Default 'percent'. */
  commissionType?: CommissionType;
  /** Used when the type is 'percent'. */
  commissionBp: number;
  /** Used when the type is 'per_unit': the commission for one unit of quantity. */
  commissionUnitCents?: number;
  /** YYYY-MM-DD: when the order was delivered. The commission is owed from then. */
  deliveredOn?: string | null;
  /** What the merchant paid the producer (gross, as invoiced). Only for the payment status. */
  payments: { amountCents: number; paidOn: string }[];
  /** What the producer paid me for this order. */
  commissionPayments: { amountCents: number }[];
  /** YYYY-MM-DD, Sofia time. */
  today: string;
}

export interface CommissionTranche {
  /** The date the commission is owed from: the delivery. */
  paidOn: string;
  amountCents: number;
  /** Within 5 Bulgarian working days of the delivery. */
  dueOn: string;
}

export interface OrderCalc {
  netCents: number;
  vatCents: number;
  grossCents: number;
  returnedNetCents: number;
  /** The commission base: net value of what was actually delivered and kept, without VAT (art. 7(4)). */
  baseNetCents: number;
  /** What the merchant owes the producer after returns. */
  payableGrossCents: number;
  paidCents: number;
  paymentStatus: PaymentStatus;
  commissionType: CommissionType;
  commissionBp: number;
  commissionUnitCents: number;
  /** Some lines have their own fixed commission per unit (set on the good). */
  commissionByGoods: boolean;
  /** The full commission once the merchant has paid everything. */
  commissionCents: number;
  /** Owed so far: the full commission once the order is delivered (whether or not the merchant has paid). */
  commissionAccruedCents: number;
  commissionReceivedCents: number;
  /** Accrued and not received yet. */
  commissionOutstandingCents: number;
  /** Accrued, past its due date and not received. */
  commissionOverdueCents: number;
  /** The earliest due date of commission that is accrued and not received. */
  commissionNextDueOn: string | null;
  commissionStatus: CommissionStatus;
  tranches: CommissionTranche[];
}

/** The single source of truth for an order's totals and commission. Used by the API and shown as is. */
export function calculateOrder(input: CalcInput): OrderCalc {
  let netCents = 0;
  let vatCents = 0;
  for (const l of input.lines) {
    const a = lineAmounts(l.quantityMilli, l.unitPriceCents, l.vatBp);
    netCents += a.netCents;
    vatCents += a.vatCents;
  }
  const grossCents = netCents + vatCents;
  const returnedNetCents = Math.min(Math.max(0, input.returnedNetCents ?? 0), netCents);
  const returnedGrossCents = netCents > 0 ? Math.round((returnedNetCents * grossCents) / netCents) : 0;
  const baseNetCents = netCents - returnedNetCents;
  const payableGrossCents = Math.max(0, grossCents - returnedGrossCents);
  const commissionType = input.commissionType ?? 'percent';
  const commissionUnitCents = input.commissionUnitCents ?? 0;
  // A line with its own fixed amount (set on the good) earns that amount for each unit. The other lines
  // follow the order: a percent of their net value, or the order's amount per unit.
  const own = input.lines.filter((l) => l.commissionUnitCents !== null && l.commissionUnitCents !== undefined);
  const rest = input.lines.filter((l) => l.commissionUnitCents === null || l.commissionUnitCents === undefined);
  const commissionByGoods = own.length > 0;
  const perUnit = (lines: CalcLine[], unit: (l: CalcLine) => number) => lines.reduce((s, l) => s + Math.round((l.quantityMilli * unit(l)) / 1000), 0);
  const ownFull = perUnit(own, (l) => l.commissionUnitCents!);
  const restNet = rest.reduce((s, l) => s + lineNetCents(l.quantityMilli, l.unitPriceCents, l.vatBp), 0);
  const restFull = commissionType === 'per_unit' ? perUnit(rest, () => commissionUnitCents) : applyBp(restNet, input.commissionBp);
  // Returns are recorded as a net value, so they reduce the commission in the same proportion as they
  // reduce the net value. A plain percent order keeps the exact percent of its base.
  const commissionCents =
    commissionType === 'percent' && !commissionByGoods
      ? applyBp(baseNetCents, input.commissionBp)
      : netCents > 0
        ? Math.round(((ownFull + restFull) * baseNetCents) / netCents)
        : ownFull + restFull;

  const payments = [...input.payments].sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);
  const paymentStatus: PaymentStatus = payableGrossCents > 0 && paidCents >= payableGrossCents ? 'paid' : paidCents > 0 ? 'partial' : 'unpaid';

  // The commission is owed in full once the order is delivered, whether or not the merchant has paid
  // the producer (the owner's rule; merchant payments are the producer's business). It is due
  // 5 Bulgarian working days after the delivery.
  const tranches: CommissionTranche[] = [];
  let accrued = 0;
  if (input.deliveredOn && commissionCents > 0) {
    tranches.push({ paidOn: input.deliveredOn, amountCents: commissionCents, dueOn: addWorkingDays(input.deliveredOn, CONTRACT.commissionDueWorkingDays) });
    accrued = commissionCents;
  }
  const commissionReceivedCents = input.commissionPayments.reduce((s, p) => s + p.amountCents, 0);
  const commissionOutstandingCents = Math.max(0, accrued - commissionReceivedCents);

  // Received money settles the oldest tranches first.
  let covered = commissionReceivedCents;
  let overdue = 0;
  let nextDue: string | null = null;
  for (const t of tranches) {
    const open = Math.max(0, t.amountCents - covered);
    covered = Math.max(0, covered - t.amountCents);
    if (open <= 0) continue;
    nextDue ??= t.dueOn;
    if (t.dueOn < input.today) overdue += open;
  }

  let commissionStatus: CommissionStatus;
  if (commissionCents <= 0) commissionStatus = 'none';
  else if (commissionReceivedCents >= commissionCents) commissionStatus = 'settled';
  else if (overdue > 0) commissionStatus = 'overdue';
  else if (commissionOutstandingCents > 0) commissionStatus = 'due';
  else commissionStatus = 'awaiting_payment';

  return {
    netCents,
    vatCents,
    grossCents,
    returnedNetCents,
    baseNetCents,
    payableGrossCents,
    paidCents,
    paymentStatus,
    commissionType,
    commissionBp: input.commissionBp,
    commissionUnitCents,
    commissionByGoods,
    commissionCents,
    commissionAccruedCents: accrued,
    commissionReceivedCents,
    commissionOutstandingCents,
    commissionOverdueCents: overdue,
    commissionNextDueOn: nextDue,
    commissionStatus,
    tranches,
  };
}

/** art. 9(2): the fee to release a buyer from future commission. */
export function releaseFeeCents(firstDealNetCents: number): number {
  return Math.max(firstDealNetCents, CONTRACT.releaseFeeMinCents);
}

/** art. 17(2): early termination penalty for one active buyer. */
export function terminationPenaltyCents(buyerTotalNetCents: number): number {
  return Math.max(applyBp(buyerTotalNetCents, CONTRACT.terminationBp), CONTRACT.terminationMinCents);
}

/** art. 16(2): penalty for concealed deals, from the last 12 months' total. */
export function concealmentPenaltyCents(last12MonthsNetCents: number): number {
  return Math.max(applyBp(last12MonthsNetCents, CONTRACT.concealmentBp), CONTRACT.concealmentMinCents);
}
