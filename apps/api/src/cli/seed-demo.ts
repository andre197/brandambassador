import '../load-env.js';
import { addDays, sofiaToday } from '@ba/shared';
import { loadConfig } from '../config.js';
import { closeDeps, createDeps } from '../deps.js';
import { hashPassword } from '../lib/password.js';
import { createServices } from '../services/index.js';
import { SYSTEM } from '../types.js';

/**
 * Demo content for local development: one producer, two merchants, goods, orders and payments.
 *   npm run seed:demo             add it (logins: producer@demo.bg / merchant@demo.bg, password demo-password)
 *   npm run seed:demo -- --remove remove it again
 * Demo parties are recognised by their ЕИК, so it never touches real data.
 */
const DEMO_EIK = { producer: '100007914', shop1: '100015836', shop2: '100023758' };
const config = loadConfig();
if (config.isProd) {
  console.error('seed-demo is for development only');
  process.exit(1);
}
const deps = createDeps(config);
const s = createServices(deps);
const admin = { ...SYSTEM, role: 'admin' as const };

try {
  const eiks = Object.values(DEMO_EIK);
  const orders = await deps.db.query<{ id: string }>(`SELECT o.id FROM orders o JOIN producers p ON p.id = o.producer_id WHERE p.eik = ANY($1)`, [eiks]);
  for (const o of orders.rows) await deps.db.query('DELETE FROM orders WHERE id = $1', [o.id]);
  await deps.db.query('DELETE FROM producers WHERE eik = ANY($1)', [eiks]);
  await deps.db.query('DELETE FROM merchants WHERE eik = ANY($1)', [eiks]);
  if (process.argv.includes('--remove')) {
    console.log('demo content removed');
  } else {
    const { id: producerId } = await s.parties.saveProducer(null, {
      name: 'Мандра Родопа ООД',
      eik: DEMO_EIK.producer,
      phone: '+359 888 111 222',
      email: 'office@mandra.example',
      address: 'с. Смилян, ул. Първа 1',
      contact_person: 'Иван Петров',
      notes: null,
      active: true,
      commission_percent: null,
      default_vat_percent: 2000,
      delivery_method: 'own_transport',
      delivery_note: 'Хладилен бус, вторник и петък',
      invoice_method: 'email',
      invoice_note: null,
      contract_number: 'ДП-2026-01',
      contract_signed_on: addDays(sofiaToday(), -340),
    });
    const shop = async (name: string, eik: string, address: string) =>
      (
        await s.parties.saveMerchant(null, {
          name,
          eik,
          phone: '+359 2 123 4567',
          email: `orders@${eik}.example`,
          address,
          contact_person: null,
          notes: null,
          active: true,
          invoice_method: 'e_invoice',
          invoice_email: `invoices@${eik}.example`,
          invoice_note: null,
          delivery_note: 'Приемане 8:00-11:00',
        })
      ).id;
    const shop1 = await shop('Био Маркет Лозенец', DEMO_EIK.shop1, 'София, бул. Черни връх 50');
    const shop2 = await s.parties.saveMerchant(null, {
      name: 'Деликатеси Пловдив',
      eik: DEMO_EIK.shop2,
      phone: '+359 32 765 432',
      email: 'shop@deli.example',
      address: 'Пловдив, ул. Главна 12',
      contact_person: 'Мария Георгиева',
      notes: null,
      active: true,
      invoice_method: 'with_delivery',
      invoice_email: null,
      invoice_note: null,
      delivery_note: null,
    });
    await s.parties.savePair(producerId, {
      merchant_id: shop2.id,
      status: 'attracted',
      commission_percent: 1200,
      introduced_on: addDays(sofiaToday(), -200),
      introduced_how: 'Среща на място',
      territory: 'Пловдив',
      products_note: null,
      active_period_days: 60,
      released_on: null,
      release_fee: null,
      special_terms: 'Индивидуална комисионна 12%',
    });
    const producerActor = { ...SYSTEM, role: 'producer' as const, producerId };
    const good = async (name_bg: string, name_en: string, unit: 'kg' | 'pcs', price: number) =>
      (await s.goods.create(producerActor, undefined, { name_bg, name_en, sku: null, unit, price, vat_percent: 2000, description: null, active: true })).id;
    const g1 = await good('Бяло саламурено сирене', 'White brine cheese', 'kg', 1250);
    const g2 = await good('Кашкавал от краве мляко', 'Yellow cow cheese', 'kg', 1890);
    const g3 = await good('Кисело мляко 3,6% 400 г', 'Yoghurt 3.6% 400 g', 'pcs', 145);

    const o1 = await s.orders.create(admin, { producer_id: producerId, merchant_id: shop1, order_date: addDays(sofiaToday(), -20), merchant_ref: 'PO-778', requested_delivery_on: null, note: null, items: [{ good_id: g1, quantity: 20_000 }, { good_id: g3, quantity: 120_000 }] });
    await s.orders.setStatus(producerActor, o1.id, { status: 'confirmed', reason: null });
    await s.orders.updateDelivery(producerActor, o1.id, { delivery_method: 'own_transport', delivery_note: null, planned_delivery_on: addDays(sofiaToday(), -18), delivered_on: addDays(sofiaToday(), -18) });
    await s.orders.updateInvoice(producerActor, o1.id, { invoice_number: '0000001234', invoice_date: addDays(sofiaToday(), -18), invoice_method: 'email', invoice_note: null });
    await s.orders.addPayment(producerActor, o1.id, { amount: 50_880, paid_on: addDays(sofiaToday(), -12), note: null });
    await s.orders.addCommissionPayment(admin, o1.id, { amount: 2000, paid_on: addDays(sofiaToday(), -8), note: 'Частично' });

    const o2 = await s.orders.create(admin, { producer_id: producerId, merchant_id: shop2.id, order_date: addDays(sofiaToday(), -3), merchant_ref: null, requested_delivery_on: addDays(sofiaToday(), 2), note: 'Моля, преди 10 ч.', items: [{ good_id: g2, quantity: 15_000 }, { good_id: g1, quantity: 10_000 }] });
    await s.orders.setStatus(producerActor, o2.id, { status: 'confirmed', reason: null });

    await s.reminders.create(admin, { merchant_id: shop1, producer_id: producerId, due_on: addDays(sofiaToday(), 5), message: 'Седмичната поръчка за сирене', remind_days_before: 2, send_now: false });

    const hash = await hashPassword('demo-password');
    await deps.db.query(`INSERT INTO users (email, name, role, producer_id, password_hash) VALUES ('producer@demo.bg', 'Иван Петров', 'producer', $1, $2) ON CONFLICT (email) DO NOTHING`, [producerId, hash]);
    await deps.db.query(`INSERT INTO users (email, name, role, merchant_id, password_hash) VALUES ('merchant@demo.bg', 'Био Маркет', 'merchant', $1, $2) ON CONFLICT (email) DO NOTHING`, [shop1, hash]);
    console.log('demo content added. Logins: producer@demo.bg / merchant@demo.bg, password demo-password');
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await closeDeps(deps);
}
