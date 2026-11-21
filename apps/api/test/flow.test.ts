import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/lib/password.js';
import { makeApp, PASSWORD, resetDb, signIn, type TestCtx } from './helpers.js';

let t: TestCtx;
type Req = Awaited<ReturnType<typeof signIn>>;
let admin: Req;
let producer: Req;
let merchant: Req;
let otherMerchant: Req;
let ids: { producer: string; merchant: string; other: string; cheese: string; milk: string };

const producerBody = { name: 'Мандра ООД', eik: '207832311', phone: '+359 888 111 222', email: 'office@mandra.bg', address: 'София' };
const merchantBody = (name: string, eik: string) => ({ name, eik, phone: '02 123 456', email: `${eik}@shop.bg`, address: 'Пловдив', invoice_method: 'e_invoice' });

beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
  await t.deps.db.end();
});

beforeEach(async () => {
  await resetDb(t.deps);
  await t.services.auth.upsertAdmin('boss@example.com', PASSWORD);
  admin = await signIn(t, 'boss@example.com', PASSWORD);
  const p = await admin('POST', '/producers', producerBody);
  expect(p.status).toBe(200);
  const m1 = await admin('POST', '/merchants', merchantBody('Магазин 1', '100031672'));
  const m2 = await admin('POST', '/merchants', merchantBody('Магазин 2', '000000000'));
  expect(m1.status, JSON.stringify(m1.body)).toBe(200);
  expect(m2.status, JSON.stringify(m2.body)).toBe(200);
  const hash = await hashPassword(PASSWORD);
  await t.deps.db.query(`INSERT INTO users (email, role, producer_id, password_hash) VALUES ('p@x.bg', 'producer', $1, $2)`, [p.body.id, hash]);
  await t.deps.db.query(`INSERT INTO users (email, role, merchant_id, password_hash) VALUES ('m@x.bg', 'merchant', $1, $2), ('m2@x.bg', 'merchant', $3, $2)`, [m1.body.id, hash, m2.body.id]);
  producer = await signIn(t, 'p@x.bg', PASSWORD);
  merchant = await signIn(t, 'm@x.bg', PASSWORD);
  otherMerchant = await signIn(t, 'm2@x.bg', PASSWORD);
  const cheese = await producer('POST', '/goods', { name_bg: 'Сирене', unit: 'kg', price: '10,00', vat_percent: 20 });
  const milk = await producer('POST', '/goods', { name_bg: 'Мляко', unit: 'l', price: 2 });
  ids = { producer: p.body.id, merchant: m1.body.id, other: m2.body.id, cheese: cheese.body.id, milk: milk.body.id };
});

describe('parties', () => {
  it('validates ЕИК and keeps it unique; the default commission is 10%', async () => {
    expect((await admin('POST', '/producers', { ...producerBody, eik: '123' })).body.error.fields.eik).toBe('validation.eik');
    expect((await admin('POST', '/producers', producerBody)).status).toBe(409);
    expect((await admin('GET', `/producers/${ids.producer}`)).body.commission_bp).toBe(1000);
  });

  it('only the admin manages producers and merchants', async () => {
    expect((await producer('POST', '/merchants', merchantBody('X', '100039591'))).status).toBe(403);
    expect((await merchant('DELETE', `/producers/${ids.producer}`)).status).toBe(403);
  });
});

describe('orders, locked prices and commission', () => {
  it('locks the price once a good is ordered; only the admin changes it', async () => {
    const o = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.cheese, quantity: 5 }] });
    expect(o.status, JSON.stringify(o.body)).toBe(200);

    // The admin is told about the new order.
    const n = await admin('GET', '/notifications');
    expect(n.body.items[0].type).toBe('order_created');

    // The producer raises the list price: the merchant keeps the agreed price, others see the new one.
    await producer('PUT', `/goods/${ids.cheese}`, { name_bg: 'Сирене', unit: 'kg', price: 12, vat_percent: 20 });
    const mine = await merchant('GET', `/goods?producer_id=${ids.producer}`);
    const cheese = mine.body.find((g: { id: string }) => g.id === ids.cheese);
    expect(cheese.my_price_cents).toBe(1000);
    expect(cheese.price_locked).toBe(true);
    const o2 = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.cheese, quantity: 1 }] });
    expect((await merchant('GET', `/orders/${o2.body.id}`)).body.items[0].unit_price_cents).toBe(1000);

    // Nobody but the admin can edit lines and prices.
    const edit = { items: [{ good_id: ids.cheese, quantity: 5, unit_price: 9, vat_percent: 20 }], commission_percent: 10 };
    expect((await producer('PUT', `/orders/${o.body.id}`, edit)).status).toBe(403);
    expect((await merchant('PUT', `/orders/${o.body.id}`, edit)).status).toBe(403);
    const edited = await admin('PUT', `/orders/${o.body.id}`, edit);
    expect(edited.status).toBe(200);
    expect(edited.body.calc.netCents).toBe(4500);
  });

  it('price change requests: merchant asks, admin approves, open orders follow', async () => {
    const o = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.cheese, quantity: 10 }] });
    const r = await merchant('POST', '/requests', { good_id: ids.cheese, order_id: o.body.id, proposed_price: 9.5, description: 'Обемна отстъпка' });
    expect(r.status).toBe(200);
    expect((await producer('GET', '/requests')).body).toHaveLength(1);
    expect((await merchant('POST', `/requests/${r.body.id}/resolve`, { decision: 'approved', new_price: 9.5 })).status).toBe(403);
    const res = await admin('POST', `/requests/${r.body.id}/resolve`, { decision: 'approved', new_price: 9.5, response: 'OK' });
    expect(res.body.status).toBe('approved');
    expect((await merchant('GET', `/orders/${o.body.id}`)).body.calc.netCents).toBe(9500);
  });

  it('commission accrues on payment and the admin records what was received', async () => {
    const o = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.cheese, quantity: 10 }] }); // 100 € net, 120 € gross
    await producer('PATCH', `/orders/${o.body.id}/status`, { status: 'confirmed' });
    await producer('PUT', `/orders/${o.body.id}/delivery`, { delivery_method: 'courier', planned_delivery_on: '2026-11-10', delivered_on: '2026-11-11' });
    let view = await producer('GET', `/orders/${o.body.id}`);
    expect(view.body.status).toBe('delivered');
    expect(view.body.calc.commissionCents).toBe(1000);
    expect(view.body.calc.commissionAccruedCents).toBe(0);

    await producer('POST', `/orders/${o.body.id}/payments`, { amount: 60, paid_on: '2026-11-12' });
    view = await producer('GET', `/orders/${o.body.id}`);
    expect(view.body.calc.commissionAccruedCents).toBe(500);
    expect(view.body.calc.paymentStatus).toBe('partial');

    expect((await producer('POST', `/orders/${o.body.id}/commission-payments`, { amount: 5, paid_on: '2026-11-13' })).status).toBe(403);
    await admin('POST', `/orders/${o.body.id}/commission-payments`, { amount: 5, paid_on: '2026-11-13' });
    const report = await admin('GET', '/reports/commissions');
    expect(report.body.totals.receivedCents).toBe(500);
    expect(report.body.payments).toHaveLength(1);

    // The merchant never sees the commission.
    const m = await merchant('GET', `/orders/${o.body.id}`);
    expect(m.body.commission_bp).toBeUndefined();
    expect(m.body.calc.commissionCents).toBeUndefined();
    expect(m.body.commission_payments).toBeUndefined();
    expect((await merchant('GET', '/reports/commissions')).status).toBe(403);
  });

  it('uses the individual rate of the buyer, and none for a pre-existing client', async () => {
    await admin('PUT', `/producers/${ids.producer}/pairs`, { merchant_id: ids.merchant, commission_percent: 15 });
    await admin('PUT', `/producers/${ids.producer}/pairs`, { merchant_id: ids.other, status: 'pre_existing' });
    const a = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.milk, quantity: 100 }] });
    const b = await otherMerchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.milk, quantity: 100 }] });
    expect((await admin('GET', `/orders/${a.body.id}`)).body.commission_bp).toBe(1500);
    expect((await admin('GET', `/orders/${b.body.id}`)).body.calc.commissionStatus).toBe('none');
  });

  it('keeps every party to its own orders', async () => {
    const o = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.milk, quantity: 1 }] });
    expect((await otherMerchant('GET', `/orders/${o.body.id}`)).status).toBe(404);
    expect((await otherMerchant('GET', '/orders')).body).toHaveLength(0);
    expect((await merchant('PATCH', `/orders/${o.body.id}/status`, { status: 'delivered' })).status).toBe(409);
    expect((await merchant('PATCH', `/orders/${o.body.id}/status`, { status: 'cancelled', reason: 'грешка' })).status).toBe(200);
  });
});

describe('reminders', () => {
  it('notifies the merchant and closes when it orders', async () => {
    const r = await admin('POST', '/reminders', { merchant_id: ids.merchant, producer_id: ids.producer, due_on: '2030-01-10', message: 'Седмична поръчка' });
    expect(r.status).toBe(200);
    const n = await merchant('GET', '/notifications');
    expect(n.body.items[0].type).toBe('reminder');
    await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.milk, quantity: 1 }] });
    expect((await merchant('GET', '/reminders')).body[0].status).toBe('done');
  });
});

describe('emails', () => {
  it('sends notices through the outbox in the reader language', async () => {
    await t.deps.db.query(`UPDATE users SET locale = 'en' WHERE email = 'p@x.bg'`);
    await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.milk, quantity: 1 }] });
    while ((await t.services.jobs.runOnce(50)) > 0);
    const toProducer = t.email.sent.find((e) => e.to === 'p@x.bg');
    expect(toProducer?.subject).toMatch(/^New order #/);
    expect(t.email.sent.find((e) => e.to === 'boss@example.com')?.subject).toMatch(/^Нова поръчка/);
  });
});
