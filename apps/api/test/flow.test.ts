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

  it('accepts producers and merchants without an email, but rejects a wrong one', async () => {
    const m = await admin('POST', '/merchants', { ...merchantBody('Без имейл', '100039591'), email: '' });
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    expect((await admin('GET', `/merchants/${m.body.id}`)).body.email).toBeNull();
    const { email: _omit, ...noEmail } = producerBody;
    expect((await admin('POST', '/producers', { ...noEmail, eik: '100047008' })).status).toBe(200);
    expect((await admin('POST', '/merchants', { ...merchantBody('Грешен', '100047015'), email: 'not-an-email' })).body.error.fields.email).toBe('validation.email');
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

  it('the admin sets prices on a new order; the next order starts from the last price', async () => {
    // Only the admin may send a price.
    const denied = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.cheese, quantity: 1, unit_price: 1 }] });
    expect(denied.status).toBe(403);

    // No earlier order: the producer's list price.
    const first = await admin('POST', '/orders', { producer_id: ids.producer, merchant_id: ids.merchant, items: [{ good_id: ids.cheese, quantity: 1 }] });
    expect((await admin('GET', `/orders/${first.body.id}`)).body.items[0].unit_price_cents).toBe(1000);

    // The admin gives another price; the merchant's next order gets it, another merchant does not.
    const second = await admin('POST', '/orders', { producer_id: ids.producer, merchant_id: ids.merchant, items: [{ good_id: ids.cheese, quantity: 2, unit_price: '8,50' }] });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect((await admin('GET', `/orders/${second.body.id}`)).body.items[0].unit_price_cents).toBe(850);
    const next = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.cheese, quantity: 1 }] });
    expect((await merchant('GET', `/orders/${next.body.id}`)).body.items[0].unit_price_cents).toBe(850);
    const other = await otherMerchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.cheese, quantity: 1 }] });
    expect((await otherMerchant('GET', `/orders/${other.body.id}`)).body.items[0].unit_price_cents).toBe(1000);
  });

  it('stores prices incl. VAT that match the order totals', async () => {
    // Odd amounts so the rounding is exercised: 3.33 € at 9%, 1.234 units.
    const odd = await producer('POST', '/goods', { name_bg: 'Мед', unit: 'kg', price: '3,33', vat_percent: 9 });
    const g = (await producer('GET', `/goods?producer_id=${ids.producer}`)).body.find((x: { id: string }) => x.id === odd.body.id);
    expect(g.price_gross_cents).toBe(363);

    const o = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: odd.body.id, quantity: 1.234 }, { good_id: ids.cheese, quantity: 3 }] });
    const order = (await admin('GET', `/orders/${o.body.id}`)).body;
    const honey = order.items.find((i: { good_id: string }) => i.good_id === odd.body.id);
    expect(honey.unit_price_gross_cents).toBe(363);
    expect(honey.line_net_cents).toBe(411);
    expect(honey.line_gross_cents).toBe(448);
    const sum = (k: string) => order.items.reduce((s: number, i: Record<string, number>) => s + (i[k] ?? 0), 0);
    expect(sum('line_net_cents')).toBe(order.calc.netCents);
    expect(sum('line_gross_cents')).toBe(order.calc.grossCents);

    // The agreed price follows the good's VAT rate.
    const agreed = async () => (await admin('GET', `/agreed-prices?merchant_id=${ids.merchant}`)).body.find((a: { good_id: string }) => a.good_id === odd.body.id);
    expect((await agreed()).price_gross_cents).toBe(363);
    await producer('PUT', `/goods/${odd.body.id}`, { name_bg: 'Мед', unit: 'kg', price: '3,33', vat_percent: 20 });
    expect((await agreed()).price_gross_cents).toBe(400);
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

  it('commission is owed once delivered, paid or not; the admin records what was received', async () => {
    const o = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.cheese, quantity: 10 }] }); // 100 € net, 120 € gross
    await producer('PATCH', `/orders/${o.body.id}/status`, { status: 'confirmed' });
    await producer('PUT', `/orders/${o.body.id}/delivery`, { delivery_method: 'courier', planned_delivery_on: '2026-11-10', delivered_on: '2026-11-11' });
    let view = await producer('GET', `/orders/${o.body.id}`);
    expect(view.body.status).toBe('delivered');
    expect(view.body.calc.commissionCents).toBe(1000);
    // Delivered: the whole commission is owed although the merchant has not paid anything.
    expect(view.body.calc.paymentStatus).toBe('unpaid');
    expect(view.body.calc.commissionAccruedCents).toBe(1000);
    expect(view.body.calc.commissionNextDueOn).toBe('2026-11-18');

    // Merchant payments are the producer's business: only the producer records them.
    expect((await admin('POST', `/orders/${o.body.id}/payments`, { amount: 60, paid_on: '2026-11-12' })).status).toBe(403);
    await producer('POST', `/orders/${o.body.id}/payments`, { amount: 60, paid_on: '2026-11-12' });
    view = await producer('GET', `/orders/${o.body.id}`);
    expect(view.body.calc.commissionAccruedCents).toBe(1000);
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

  it('merchants have no commission terms: the producer\'s applies, none for a pre-existing client', async () => {
    // A commission sent with the merchant terms is ignored.
    await admin('PUT', `/producers/${ids.producer}/pairs`, { merchant_id: ids.merchant, commission_percent: 15 });
    await admin('PUT', `/producers/${ids.producer}/pairs`, { merchant_id: ids.other, status: 'pre_existing' });
    const a = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.milk, quantity: 100 }] });
    const b = await otherMerchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.milk, quantity: 100 }] });
    expect((await admin('GET', `/orders/${a.body.id}`)).body.commission_bp).toBe(1000);
    expect((await admin('GET', `/orders/${b.body.id}`)).body.calc.commissionStatus).toBe('none');
    const pairs = (await admin('GET', `/producers/${ids.producer}/pairs`)).body;
    expect(pairs[0].commission_bp).toBeUndefined();
  });

  it('charges a fixed amount per unit at the producer or order level', async () => {
    // Producer: 0.25 € per unit.
    const p = (await admin('GET', `/producers/${ids.producer}`)).body;
    const put = await admin('PUT', `/producers/${ids.producer}`, { ...producerBody, commission_type: 'per_unit', commission_unit: '0,25', active: p.active });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect((await admin('PUT', `/producers/${ids.producer}`, { ...producerBody, commission_type: 'per_unit' })).body.error.fields.commission_unit).toBe('validation.required');
    const a = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.milk, quantity: 40 }] });
    const oa = (await admin('GET', `/orders/${a.body.id}`)).body;
    expect(oa.commission_type).toBe('per_unit');
    expect(oa.calc.commissionCents).toBe(1000);
    // The merchant still sees no commission.
    const seen = (await merchant('GET', `/orders/${a.body.id}`)).body;
    expect(seen.commission_type).toBeUndefined();
    expect(seen.commission_unit_cents).toBeUndefined();

    // Every merchant gets the producer's terms.
    const b = await otherMerchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.milk, quantity: 40 }] });
    const ob = (await admin('GET', `/orders/${b.body.id}`)).body;
    expect(ob.commission_type).toBe('per_unit');
    expect(ob.calc.commissionCents).toBe(1000);

    // Order: the admin switches one order to 0.15 € per unit.
    const edit = { items: [{ id: ob.items[0].id, good_id: ids.milk, quantity: 40, unit_price: 2, vat_percent: 20 }], commission_type: 'per_unit', commission_unit: '0.15' };
    const edited = await admin('PUT', `/orders/${b.body.id}`, edit);
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.calc.commissionCents).toBe(600);
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

describe('shops and the extended orders view', () => {
  it('orders go to a shop of the merchant; the extended view has one row per good', async () => {
    // Only the admin manages shops.
    expect((await merchant('POST', `/merchants/${ids.merchant}/shops`, { alias: 'X', address: 'Y' })).status).toBe(403);
    const center = await admin('POST', `/merchants/${ids.merchant}/shops`, { alias: 'Център', address: 'Пловдив, ул. Главна 1' });
    expect(center.status, JSON.stringify(center.body)).toBe(200);
    await admin('POST', `/merchants/${ids.merchant}/shops`, { alias: 'Тракия', address: 'Пловдив, бул. Освобождение 5' });
    expect((await admin('POST', `/merchants/${ids.merchant}/shops`, { alias: 'център', address: 'Z' })).body.error.fields.alias).toBe('validation.alias_taken');
    expect((await merchant('GET', `/merchants/${ids.merchant}/shops`)).body).toHaveLength(2);

    // With shops, the order must name one, and it keeps the shop's alias and address.
    const missing = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.milk, quantity: 1 }] });
    expect(missing.body.error.fields.shop_id).toBe('validation.required');
    const o = await merchant('POST', '/orders', { producer_id: ids.producer, shop_id: center.body.id, items: [{ good_id: ids.milk, quantity: 3 }, { good_id: ids.cheese, quantity: 2 }] });
    expect(o.status, JSON.stringify(o.body)).toBe(200);
    const detail = (await merchant('GET', `/orders/${o.body.id}`)).body;
    expect(detail.items.every((i: { shop_alias: string }) => i.shop_alias === 'Център')).toBe(true);
    expect(detail.items[0].shop_address).toBe('Пловдив, ул. Главна 1');
    expect(detail.shop_aliases).toBe('Център');

    // A merchant without shops: the merchant's own address.
    await otherMerchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.milk, quantity: 1 }] });

    const lines = await producer('GET', '/orders/lines');
    expect(lines.status).toBe(200);
    expect(lines.body).toHaveLength(3);
    const cheese = lines.body.find((l: { order_id: string; name_bg: string }) => l.order_id === o.body.id && l.name_bg === 'Сирене');
    expect(cheese).toMatchObject({ merchant_eik: '100031672', merchant_name: 'Магазин 1', shop_alias: 'Център', address: 'Пловдив, ул. Главна 1', line_net_cents: 2000, line_gross_cents: 2400 });
    expect(lines.body.find((l: { shop_alias: string | null }) => l.shop_alias === null).address).toBe('Пловдив');
    // The same filters as the list.
    expect((await producer('GET', `/orders/lines?merchant_id=${ids.other}`)).body).toHaveLength(1);
    expect((await merchant('GET', '/orders/lines')).status).toBe(403);
  });

  it('one order for the company can cover several of its shops', async () => {
    const s1 = (await admin('POST', `/merchants/${ids.merchant}/shops`, { alias: 'Shop 1', address: 'Адрес 1' })).body.id;
    const s2 = (await admin('POST', `/merchants/${ids.merchant}/shops`, { alias: 'Shop 2', address: 'Адрес 2' })).body.id;
    // 200 for shop 1 and 300 for shop 2, in one order. Every line must name its shop.
    const bad = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.milk, quantity: 200, shop_id: s1 }, { good_id: ids.milk, quantity: 300 }] });
    expect(bad.body.error.fields['items.1.shop_id']).toBe('validation.required');
    const o = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.milk, quantity: 200, shop_id: s1 }, { good_id: ids.milk, quantity: 300, shop_id: s2 }] });
    expect(o.status, JSON.stringify(o.body)).toBe(200);
    const d = (await admin('GET', `/orders/${o.body.id}`)).body;
    expect(d.items.map((i: { shop_alias: string; quantity_milli: number }) => [i.shop_alias, i.quantity_milli])).toEqual([
      ['Shop 1', 200_000],
      ['Shop 2', 300_000],
    ]);
    expect(d.shop_aliases).toBe('Shop 1, Shop 2');
    expect(d.calc.netCents).toBe(100_000);
    // One order in the list, two rows in the extended view.
    expect((await producer('GET', '/orders')).body).toHaveLength(1);
    const lines = (await producer('GET', '/orders/lines')).body;
    expect(lines.map((l: { shop_alias: string; address: string }) => `${l.shop_alias}: ${l.address}`)).toEqual(['Shop 1: Адрес 1', 'Shop 2: Адрес 2']);

    // The admin moves a line to the other shop.
    const edit = {
      items: d.items.map((i: { id: string; quantity_milli: number }, n: number) => ({ id: i.id, good_id: ids.milk, quantity: i.quantity_milli / 1000, unit_price: 2, vat_percent: 20, ...(n === 0 ? { shop_id: s2 } : {}) })),
      commission_type: 'percent',
      commission_percent: 10,
    };
    const edited = await admin('PUT', `/orders/${o.body.id}`, edit);
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.items.every((i: { shop_alias: string }) => i.shop_alias === 'Shop 2')).toBe(true);
  });
});

describe('commission set on a good', () => {
  it('a good can have its own fixed commission per unit; else the producer\'s applies', async () => {
    // Only the admin sets it; a producer saving the good keeps it.
    expect((await producer('PUT', `/goods/${ids.cheese}`, { name_bg: 'Сирене', unit: 'kg', price: 10, commission_unit: '1' })).status).toBe(403);
    expect((await admin('PUT', `/goods/${ids.cheese}`, { name_bg: 'Сирене', unit: 'kg', price: 10, vat_percent: 20, commission_unit: '0,50' })).status).toBe(200);
    expect((await producer('PUT', `/goods/${ids.cheese}`, { name_bg: 'Сирене', unit: 'kg', price: 10, vat_percent: 20 })).status).toBe(200);
    const goods = (await producer('GET', `/goods?producer_id=${ids.producer}`)).body;
    expect(goods.find((g: { id: string }) => g.id === ids.cheese).commission_unit_cents).toBe(50);
    // Merchants never see it.
    const seen = (await merchant('GET', `/goods?producer_id=${ids.producer}`)).body;
    expect(seen.find((g: { id: string }) => g.id === ids.cheese).commission_unit_cents).toBeUndefined();

    // Producer at 10%: cheese 4 kg x 0.50 € = 2.00 €, milk 10 l x 2 € = 20 € at 10% = 2.00 €.
    const o = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.cheese, quantity: 4 }, { good_id: ids.milk, quantity: 10 }] });
    const order = (await admin('GET', `/orders/${o.body.id}`)).body;
    expect(order.calc.commissionCents).toBe(400);
    expect(order.calc.commissionByGoods).toBe(true);
    const mine = (await merchant('GET', `/orders/${o.body.id}`)).body;
    expect(mine.items[0].commission_unit_cents).toBeUndefined();

    // A merchant that carries no commission (existing client): not even the goods' amounts.
    await admin('PUT', `/producers/${ids.producer}/pairs`, { merchant_id: ids.other, status: 'pre_existing' });
    const b = await otherMerchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.cheese, quantity: 4 }] });
    const ob = (await admin('GET', `/orders/${b.body.id}`)).body;
    expect(ob.calc.commissionByGoods).toBe(false);
    expect(ob.calc.commissionCents).toBe(0);

    // The admin can clear a line's own amount: it then follows the order (10% of 40 € = 4 €).
    const line = order.items.find((i: { good_id: string }) => i.good_id === ids.cheese);
    const other = order.items.find((i: { good_id: string }) => i.good_id === ids.milk);
    const edited = await admin('PUT', `/orders/${o.body.id}`, {
      items: [
        { id: line.id, good_id: ids.cheese, quantity: 4, unit_price: 10, vat_percent: 20, commission_unit: null },
        { id: other.id, good_id: ids.milk, quantity: 10, unit_price: 2, vat_percent: 20 },
      ],
      commission_type: 'percent',
      commission_percent: 10,
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.calc.commissionCents).toBe(600);
    expect(edited.body.calc.commissionByGoods).toBe(false);
  });
});

describe('the producer asks for a new price of a good', () => {
  it('a linked good: only through a request; approving changes nothing but the good', async () => {
    // Not linked yet: the producer changes the price itself.
    expect((await producer('PUT', `/goods/${ids.cheese}`, { name_bg: 'Сирене', unit: 'kg', price: 11, vat_percent: 20 })).status).toBe(200);
    const o = await merchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.cheese, quantity: 2 }] });
    expect(o.status).toBe(200);

    // Linked now: the price is locked for the producer, other fields are not.
    const locked = await producer('PUT', `/goods/${ids.cheese}`, { name_bg: 'Сирене', unit: 'kg', price: 15, vat_percent: 20 });
    expect(locked.body.error.fields.price).toBe('validation.price_locked');
    expect((await producer('PUT', `/goods/${ids.cheese}`, { name_bg: 'Бяло сирене', unit: 'kg', price: 11, vat_percent: 20 })).status).toBe(200);
    const g = (await producer('GET', `/goods?producer_id=${ids.producer}`)).body.find((x: { id: string }) => x.id === ids.cheese);
    expect(g.price_linked).toBe(true);

    // The request: no merchant, a proposed price; the admin is told.
    expect((await producer('POST', '/requests', { good_id: ids.cheese })).body.error.fields.proposed_price).toBe('validation.price_required');
    const req = await producer('POST', '/requests', { good_id: ids.cheese, proposed_price: 15, description: 'Нова реколта' });
    expect(req.status, JSON.stringify(req.body)).toBe(200);
    const n = (await admin('GET', '/notifications')).body.items.find((x: { type: string }) => x.type === 'request_created');
    expect(n.data).toMatchObject({ kind: 'list', merchant: '', proposed: 1500 });
    expect((await producer('GET', `/goods?producer_id=${ids.producer}`)).body.find((x: { id: string }) => x.id === ids.cheese).pending_price_cents).toBe(1500);

    // Approved: the good's price changes; the merchant's agreed price and the order do not.
    const done = await admin('POST', `/requests/${req.body.id}/resolve`, { decision: 'approved', new_price: 15, apply_to_open_orders: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await producer('GET', `/goods?producer_id=${ids.producer}`)).body.find((x: { id: string }) => x.id === ids.cheese).price_cents).toBe(1500);
    expect((await merchant('GET', `/goods?producer_id=${ids.producer}`)).body.find((x: { id: string }) => x.id === ids.cheese).my_price_cents).toBe(1100);
    expect((await admin('GET', `/orders/${o.body.id}`)).body.items[0].unit_price_cents).toBe(1100);
    // The merchant sees its agreed prices only, never the producer's current (wanted) price.
    const mine = (await merchant('GET', '/agreed-prices')).body;
    expect(mine[0].price_cents).toBe(1100);
    expect(mine[0].list_price_cents).toBeUndefined();
    expect((await admin('GET', `/agreed-prices?merchant_id=${ids.merchant}`)).body[0].list_price_cents).toBe(1500);
    // A merchant without orders of it gets the new price.
    const b = await otherMerchant('POST', '/orders', { producer_id: ids.producer, items: [{ good_id: ids.cheese, quantity: 1 }] });
    expect((await admin('GET', `/orders/${b.body.id}`)).body.items[0].unit_price_cents).toBe(1500);
  });
});
