import { addWorkingDays } from './calendar.js';
import { CONTRACT, type CommissionStatus, type PaymentStatus } from './types.js';

/**
 * Money is integer euro cents, percentages are basis points (1000 = 10%), quantities are
 * thousandths (1500 = 1.5 kg), so every calculation is exact integer arithmetic.
 */

export const percentToBp = (percent: number) => Math.round(percent * 100);
export const bpToPercent = (bp: number) => bp / 100;
export const qtyToMilli = (qty: number) => Math.round(qty * 1000);
export const milliToQty = (milli: number) => milli / 1000;
export const eurToCents = (eur: number) => Math.round(eur * 100);

export const lineNetCents = (quantityMilli: number, unitPriceCents: number) => Math.round((quantityMilli * unitPriceCents) / 1000);
export const applyBp = (cents: number, bp: number) => Math.round((cents * bp) / 10_000);

export interface CalcLine {
  quantityMilli: number;
  /** Net price per unit, without VAT. */
  unitPriceCents: number;
  vatBp: number;
}

export interface CalcInput {
  lines: CalcLine[];
  /** Net value (without VAT) of returned or credited goods (art. 10). */
  returnedNetCents?: number;
  commissionBp: number;
  /** What the merchant paid the producer (gross, as invoiced). */
  payments: { amountCents: number; paidOn: string }[];
  /** What the producer paid me for this order. */
  commissionPayments: { amountCents: number }[];
  /** YYYY-MM-DD, Sofia time. */
  today: string;
}

export interface CommissionTranche {
  paidOn: string;
  /** Commission accrued by this payment of the merchant. */
  amountCents: number;
  /** art. 8(3): within 5 working days of the producer receiving the payment. */
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
  commissionBp: number;
  /** The full commission once the merchant has paid everything. */
  commissionCents: number;
  /** Accrued so far: in proportion to what the merchant actually paid (art. 8(1)-(2)). */
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
    const net = lineNetCents(l.quantityMilli, l.unitPriceCents);
    netCents += net;
    vatCents += applyBp(net, l.vatBp);
  }
  const grossCents = netCents + vatCents;
  const returnedNetCents = Math.min(Math.max(0, input.returnedNetCents ?? 0), netCents);
  const returnedGrossCents = netCents > 0 ? Math.round((returnedNetCents * grossCents) / netCents) : 0;
  const baseNetCents = netCents - returnedNetCents;
  const payableGrossCents = Math.max(0, grossCents - returnedGrossCents);
  const commissionCents = applyBp(baseNetCents, input.commissionBp);

  const payments = [...input.payments].sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);
  const paymentStatus: PaymentStatus = payableGrossCents > 0 && paidCents >= payableGrossCents ? 'paid' : paidCents > 0 ? 'partial' : 'unpaid';

  // Each payment of the merchant accrues its share of the commission.
  const tranches: CommissionTranche[] = [];
  let cumulative = 0;
  let accrued = 0;
  for (const p of payments) {
    if (payableGrossCents <= 0 || commissionCents <= 0) break;
    cumulative = Math.min(payableGrossCents, cumulative + p.amountCents);
    const total = Math.round((commissionCents * cumulative) / payableGrossCents);
    if (total > accrued) {
      tranches.push({ paidOn: p.paidOn, amountCents: total - accrued, dueOn: addWorkingDays(p.paidOn, CONTRACT.commissionDueWorkingDays) });
      accrued = total;
    }
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
    commissionBp: input.commissionBp,
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
