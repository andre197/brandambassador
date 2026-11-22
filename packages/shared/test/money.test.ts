import { describe, expect, it } from 'vitest';
import { addWorkingDays, bgHolidays, isWorkingDay, orthodoxEaster } from '../src/calendar.js';
import { isValidEik } from '../src/eik.js';
import { calculateOrder, lineAmounts, releaseFeeCents, terminationPenaltyCents } from '../src/money.js';

const line = (qty: number, priceCents: number, vatBp = 2000) => ({ quantityMilli: qty * 1000, unitPriceCents: priceCents, vatBp });

describe('calculateOrder', () => {
  it('computes the commission on the net value without VAT (art. 7(4))', () => {
    const c = calculateOrder({ lines: [line(10, 250), line(2, 1000)], commissionBp: 1000, payments: [], commissionPayments: [], today: '2026-11-20' });
    expect(c.netCents).toBe(4500);
    expect(c.vatCents).toBe(900);
    expect(c.grossCents).toBe(5400);
    expect(c.commissionCents).toBe(450);
    expect(c.commissionAccruedCents).toBe(0);
    expect(c.commissionStatus).toBe('awaiting_payment');
    expect(c.paymentStatus).toBe('unpaid');
  });

  it('owes the full commission once delivered, paid or not, due 5 working days after the delivery', () => {
    const base = { lines: [line(100, 100)], commissionBp: 1000, commissionPayments: [] }; // 100 € net, 120 € gross
    // Not delivered: nothing owed yet, even if the merchant paid.
    const before = calculateOrder({ ...base, payments: [{ amountCents: 12000, paidOn: '2026-11-10' }], today: '2026-11-19' });
    expect(before.commissionAccruedCents).toBe(0);
    expect(before.commissionStatus).toBe('awaiting_payment');
    // Delivered on a Friday, nothing paid by the merchant: all 10 € owed, due the next Friday.
    const c = calculateOrder({ ...base, deliveredOn: '2026-11-13', payments: [], today: '2026-11-19' });
    expect(c.paymentStatus).toBe('unpaid');
    expect(c.commissionAccruedCents).toBe(1000);
    expect(c.tranches[0]!.dueOn).toBe('2026-11-20');
    expect(c.commissionStatus).toBe('due');
    const later = calculateOrder({ ...base, deliveredOn: '2026-11-13', payments: [], today: '2026-11-23' });
    expect(later.commissionOverdueCents).toBe(1000);
    expect(later.commissionStatus).toBe('overdue');
  });

  it('settles once the producer paid the full commission', () => {
    const c = calculateOrder({
      lines: [line(1, 10000)],
      commissionBp: 1250,
      deliveredOn: '2026-10-01',
      payments: [],
      commissionPayments: [{ amountCents: 1250 }],
      today: '2026-11-20',
    });
    expect(c.commissionCents).toBe(1250);
    expect(c.commissionOutstandingCents).toBe(0);
    expect(c.commissionStatus).toBe('settled');
  });

  it('multiplies the price incl. VAT by the quantity, then takes the total excl. VAT out of it', () => {
    // 0.23 € excl. VAT at 20% is 0.28 € incl. VAT per piece; 540 pieces = 151.20 €, of which 126.00 € excl. VAT.
    expect(lineAmounts(540_000, 23, 2000)).toEqual({ grossCents: 15120, netCents: 12600, vatCents: 2520 });
    const c = calculateOrder({ lines: [line(540, 23)], commissionBp: 1000, payments: [], commissionPayments: [], today: '2026-11-20' });
    expect(c.grossCents).toBe(15120);
    expect(c.netCents).toBe(12600);
    expect(c.commissionCents).toBe(1260);
  });

  it('charges a fixed amount per unit when the commission is per unit', () => {
    // 10 units + 2.5 units at 0.30 € each = 3.75 €, whatever the prices.
    const c = calculateOrder({
      lines: [line(10, 250), { quantityMilli: 2500, unitPriceCents: 1000, vatBp: 2000 }],
      commissionType: 'per_unit',
      commissionBp: 1000,
      commissionUnitCents: 30,
      deliveredOn: '2026-11-02',
      payments: [{ amountCents: 3000, paidOn: '2026-11-02' }],
      commissionPayments: [],
      today: '2026-11-20',
    });
    expect(c.netCents).toBe(5000);
    expect(c.commissionCents).toBe(375);
    expect(c.commissionType).toBe('per_unit');
    // Delivered: all of it is owed, although the merchant paid only half.
    expect(c.commissionAccruedCents).toBe(375);

    // Returns lower it in the same proportion as the net value: 20% returned.
    const r = calculateOrder({ lines: [line(10, 1000)], returnedNetCents: 2000, commissionType: 'per_unit', commissionBp: 0, commissionUnitCents: 50, payments: [], commissionPayments: [], today: '2026-11-20' });
    expect(r.commissionCents).toBe(400);
  });

  it('reduces the base by returned goods (art. 10)', () => {
    const c = calculateOrder({ lines: [line(10, 1000)], returnedNetCents: 2000, commissionBp: 1000, deliveredOn: '2026-11-02', payments: [{ amountCents: 9600, paidOn: '2026-11-02' }], commissionPayments: [], today: '2026-11-20' });
    expect(c.baseNetCents).toBe(8000);
    expect(c.payableGrossCents).toBe(9600);
    expect(c.commissionCents).toBe(800);
    expect(c.commissionAccruedCents).toBe(800);
    expect(c.paymentStatus).toBe('paid');
  });

  it('caps overpayment and has no commission at 0%', () => {
    const c = calculateOrder({ lines: [line(1, 1000)], commissionBp: 0, deliveredOn: '2026-11-02', payments: [{ amountCents: 99999, paidOn: '2026-11-02' }], commissionPayments: [], today: '2026-11-20' });
    expect(c.commissionStatus).toBe('none');
    expect(c.commissionAccruedCents).toBe(0);
  });
});

describe('contract fees', () => {
  it('applies the minimums', () => {
    expect(releaseFeeCents(20_000)).toBe(50_000);
    expect(releaseFeeCents(80_000)).toBe(80_000);
    expect(terminationPenaltyCents(1_000_000)).toBe(100_000);
    expect(terminationPenaltyCents(10_000)).toBe(50_000);
  });
});

describe('Bulgarian working days', () => {
  it('knows Orthodox Easter', () => {
    expect(orthodoxEaster(2025)).toBe('2025-04-20');
    expect(orthodoxEaster(2026)).toBe('2026-04-12');
  });

  it('skips weekends, holidays and moved holidays', () => {
    expect(isWorkingDay('2026-03-03')).toBe(false);
    expect(bgHolidays(2026).has('2026-05-25')).toBe(true); // 24 May 2026 is a Sunday
    expect(addWorkingDays('2026-12-23', 5)).toBe('2027-01-05'); // 24-26 Dec, 28 Dec (moved), 1 Jan
    expect(addWorkingDays('2026-11-20', 5)).toBe('2026-11-27');
  });
});

describe('ЕИК', () => {
  it('validates check digits', () => {
    expect(isValidEik('207832311')).toBe(true);
    expect(isValidEik('207832312')).toBe(false);
    expect(isValidEik('BG207832311')).toBe(true);
    expect(isValidEik('12345')).toBe(false);
  });
});
