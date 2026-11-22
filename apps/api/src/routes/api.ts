import {
  agreedPriceSchema,
  goodInputSchema,
  merchantInputSchema,
  orderAdminEditSchema,
  orderCreateSchema,
  orderDeliverySchema,
  orderListQuerySchema,
  orderReturnSchema,
  orderStatusSchema,
  pairInputSchema,
  paymentInputSchema,
  priceRequestSchema,
  producerInputSchema,
  reminderInputSchema,
  reminderStatusSchema,
  REMINDER_STATUSES,
  reportQuerySchema,
  REQUEST_STATUSES,
  resolveRequestSchema,
  settingsInputSchema,
  shopInputSchema,
  userCreateSchema,
  uuidSchema,
} from '@ba/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireAdmin, requireAuth } from '../plugins/auth.js';

const idParam = z.object({ id: uuidSchema });
const subParam = z.object({ id: uuidSchema, sub: uuidSchema });
const pricePair = z.object({ goodId: uuidSchema, merchantId: uuidSchema });
const producerQuery = z.object({ producer_id: uuidSchema.optional() });
const pricesQuery = z.object({ producer_id: uuidSchema.optional(), merchant_id: uuidSchema.optional() });
const usersQuery = z.object({ producer_id: uuidSchema.optional(), merchant_id: uuidSchema.optional() });
const userCreateBody = userCreateSchema.extend({ producer_id: uuidSchema.optional(), merchant_id: uuidSchema.optional() });
const readBody = z.object({ ids: z.array(uuidSchema).max(500).nullish() });
const activeBody = z.object({ active: z.boolean() });
const requestsQuery = z.object({ status: z.enum(REQUEST_STATUSES).optional() });
const remindersQuery = z.object({ merchant_id: uuidSchema.optional(), status: z.enum(REMINDER_STATUSES).optional() });

const ok = { ok: true } as const;

/** Everything here needs a signed-in user; services narrow what each role sees and may change. */
const apiRoutes: FastifyPluginAsync = async (app) => {
  const s = app.services;

  app.addHook('preHandler', async (req) => {
    requireAuth(req);
  });
  const actor = (req: FastifyRequest) => requireAuth(req);
  const id = (req: FastifyRequest) => parse(idParam, req.params).id;
  const sub = (req: FastifyRequest) => parse(subParam, req.params);

  app.get('/dashboard', async (req) => s.reports.dashboard(actor(req)));

  // ─── Notifications ───
  app.get('/notifications', async (req) => s.notifications.list(actor(req)));
  app.post('/notifications/read', async (req) => {
    await s.notifications.markRead(actor(req), parse(readBody, req.body).ids ?? null);
    return ok;
  });

  // ─── Producers ───
  app.get('/producers', async (req) => s.parties.listProducers(actor(req)));
  app.get('/producers/:id', async (req) => s.parties.producer(actor(req), id(req)));
  app.post('/producers', async (req) => {
    requireAdmin(req);
    return s.parties.saveProducer(null, parse(producerInputSchema, req.body));
  });
  app.put('/producers/:id', async (req) => {
    requireAdmin(req);
    return s.parties.saveProducer(id(req), parse(producerInputSchema, req.body));
  });
  app.delete('/producers/:id', async (req) => {
    requireAdmin(req);
    await s.parties.deleteProducer(id(req));
    return ok;
  });
  app.get('/producers/:id/pairs', async (req) => s.parties.pairs(actor(req), { producerId: id(req) }));
  app.put('/producers/:id/pairs', async (req) => {
    requireAdmin(req);
    return s.parties.savePair(id(req), parse(pairInputSchema, req.body));
  });
  app.delete('/producers/:id/pairs/:sub', async (req) => {
    requireAdmin(req);
    const p = sub(req);
    await s.parties.deletePair(p.id, p.sub);
    return ok;
  });
  app.get('/producers/:id/trade', async (req) => s.reports.trade(actor(req), id(req)));

  // ─── Merchants ───
  app.get('/merchants', async (req) => s.parties.listMerchants(actor(req)));
  app.get('/merchants/:id', async (req) => s.parties.merchant(actor(req), id(req)));
  app.post('/merchants', async (req) => {
    requireAdmin(req);
    return s.parties.saveMerchant(null, parse(merchantInputSchema, req.body));
  });
  app.put('/merchants/:id', async (req) => {
    requireAdmin(req);
    return s.parties.saveMerchant(id(req), parse(merchantInputSchema, req.body));
  });
  app.delete('/merchants/:id', async (req) => {
    requireAdmin(req);
    await s.parties.deleteMerchant(id(req));
    return ok;
  });
  app.get('/merchants/:id/pairs', async (req) => {
    requireAdmin(req);
    return s.parties.pairs(actor(req), { merchantId: id(req) });
  });
  app.get('/merchants/:id/shops', async (req) => s.parties.shops(actor(req), id(req)));
  app.post('/merchants/:id/shops', async (req) => {
    requireAdmin(req);
    return s.parties.saveShop(id(req), null, parse(shopInputSchema, req.body));
  });
  app.put('/merchants/:id/shops/:sub', async (req) => {
    requireAdmin(req);
    const p = parse(subParam, req.params);
    return s.parties.saveShop(p.id, p.sub, parse(shopInputSchema, req.body));
  });
  app.delete('/merchants/:id/shops/:sub', async (req) => {
    requireAdmin(req);
    const p = parse(subParam, req.params);
    await s.parties.deleteShop(p.id, p.sub);
    return ok;
  });

  // ─── Own profile ───
  app.get('/profile', async (req) => {
    const a = actor(req);
    if (a.role === 'producer') return s.parties.producer(a, a.producerId!);
    if (a.role === 'merchant') return s.parties.merchant(a, a.merchantId!);
    throw new AppError('not_found');
  });
  app.put('/profile', async (req) => s.parties.updateOwnProfile(actor(req), req.body));

  // ─── Users (logins of producers, merchants and admins) ───
  app.get('/users', async (req) => {
    requireAdmin(req);
    const q = parse(usersQuery, req.query);
    return s.auth.listUsers({ producerId: q.producer_id, merchantId: q.merchant_id });
  });
  app.post('/users', async (req) => {
    requireAdmin(req);
    const b = parse(userCreateBody, req.body);
    const role = b.producer_id ? 'producer' : b.merchant_id ? 'merchant' : 'admin';
    return s.auth.createUser({ ...b, role, producerId: b.producer_id, merchantId: b.merchant_id });
  });
  app.patch('/users/:id', async (req) => {
    const a = requireAdmin(req);
    const userId = id(req);
    if (userId === a.userId) throw new AppError('invalid_state');
    await s.auth.setUserActive(userId, parse(activeBody, req.body).active);
    return ok;
  });
  app.post('/users/:id/invite', async (req) => {
    requireAdmin(req);
    const u = await s.auth.user(id(req));
    if (!u) throw new AppError('not_found');
    await s.auth.sendInvite(u.id);
    return ok;
  });
  app.delete('/users/:id', async (req) => {
    await s.auth.deleteUser(id(req), requireAdmin(req));
    return ok;
  });

  // ─── Goods and agreed prices ───
  app.get('/goods', async (req) => s.goods.list(actor(req), parse(producerQuery, req.query).producer_id));
  app.post('/goods', async (req) => s.goods.create(actor(req), parse(producerQuery, req.query).producer_id, parse(goodInputSchema, req.body)));
  app.put('/goods/:id', async (req) => s.goods.update(actor(req), id(req), parse(goodInputSchema, req.body)));
  app.delete('/goods/:id', async (req) => s.goods.remove(actor(req), id(req)));

  app.get('/agreed-prices', async (req) => {
    const q = parse(pricesQuery, req.query);
    return s.goods.agreedPrices(actor(req), { producerId: q.producer_id, merchantId: q.merchant_id });
  });
  app.put('/agreed-prices/:goodId/:merchantId', async (req) => {
    const p = parse(pricePair, req.params);
    return s.requests.setAgreedPrice(actor(req), p.goodId, p.merchantId, parse(agreedPriceSchema, req.body));
  });
  app.delete('/agreed-prices/:goodId/:merchantId', async (req) => {
    const p = parse(pricePair, req.params);
    await s.requests.deleteAgreedPrice(actor(req), p.goodId, p.merchantId);
    return ok;
  });

  // ─── Orders ───
  app.get('/orders', async (req) => s.orders.list(actor(req), parse(orderListQuerySchema, req.query)));
  // The extended view: one row for each good of the orders the list shows.
  app.get('/orders/lines', async (req) => s.orders.lines(actor(req), parse(orderListQuerySchema, req.query)));
  app.post('/orders', async (req) => s.orders.create(actor(req), parse(orderCreateSchema, req.body)));
  app.get('/orders/:id', async (req) => s.orders.get(actor(req), id(req)));
  app.put('/orders/:id', async (req) => s.orders.adminEdit(actor(req), id(req), parse(orderAdminEditSchema, req.body)));
  app.delete('/orders/:id', async (req) => {
    await s.orders.remove(actor(req), id(req));
    return ok;
  });
  app.patch('/orders/:id/status', async (req) => s.orders.setStatus(actor(req), id(req), parse(orderStatusSchema, req.body)));
  app.put('/orders/:id/delivery', async (req) => s.orders.updateDelivery(actor(req), id(req), parse(orderDeliverySchema, req.body)));
  app.put('/orders/:id/return', async (req) => s.orders.updateReturn(actor(req), id(req), parse(orderReturnSchema, req.body)));
  app.post('/orders/:id/payments', async (req) => s.orders.addPayment(actor(req), id(req), parse(paymentInputSchema, req.body)));
  app.delete('/orders/:id/payments/:sub', async (req) => {
    const p = sub(req);
    return s.orders.deletePayment(actor(req), p.id, p.sub);
  });
  app.post('/orders/:id/commission-payments', async (req) => s.orders.addCommissionPayment(actor(req), id(req), parse(paymentInputSchema, req.body)));
  app.delete('/orders/:id/commission-payments/:sub', async (req) => {
    const p = sub(req);
    return s.orders.deleteCommissionPayment(actor(req), p.id, p.sub);
  });

  // ─── Price change requests ───
  app.get('/requests', async (req) => s.requests.list(actor(req), parse(requestsQuery, req.query).status));
  app.post('/requests', async (req) => s.requests.create(actor(req), parse(priceRequestSchema, req.body)));
  app.post('/requests/:id/resolve', async (req) => s.requests.resolve(actor(req), id(req), parse(resolveRequestSchema, req.body)));

  // ─── Reminders to merchants ───
  app.get('/reminders', async (req) => {
    const q = parse(remindersQuery, req.query);
    return s.reminders.list(actor(req), { merchantId: q.merchant_id, status: q.status });
  });
  app.post('/reminders', async (req) => s.reminders.create(actor(req), parse(reminderInputSchema, req.body)));
  app.put('/reminders/:id', async (req) => s.reminders.update(actor(req), id(req), parse(reminderInputSchema, req.body)));
  app.patch('/reminders/:id/status', async (req) => {
    await s.reminders.setStatus(actor(req), id(req), parse(reminderStatusSchema, req.body).status);
    return ok;
  });
  app.delete('/reminders/:id', async (req) => {
    await s.reminders.remove(actor(req), id(req));
    return ok;
  });

  // ─── Reports and settings ───
  app.get('/reports/commissions', async (req) => s.reports.commissions(actor(req), parse(reportQuerySchema, req.query)));
  app.get('/settings', async (req) => {
    requireAdmin(req);
    return s.settings.get();
  });
  app.put('/settings', async (req) => {
    requireAdmin(req);
    return s.settings.update(parse(settingsInputSchema, req.body));
  });
};

export default apiRoutes;
