'use client';

import { calculateOrder, COMMISSION_TYPES, type CommissionType, DELIVERY_METHODS, type OrderStatus, qtyToMilli, type Role } from '@ba/shared';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useState } from 'react';
import { api } from '@/lib/api-client';
import type { Good, OrderDetail, OrderItem, Shop } from '@/lib/types';
import { CommissionBadge, OrderStatusBadge, PaymentBadge, RequestBadge } from '../badges';
import { Btn, Card, Check, ConfirmBtn, Empty, ErrorNote, Facts, In, InfoNote, Modal, Sel, Table, td, tdNum, todayIso, Txt, useAction, useData, useFmt } from '../kit';
import { useMe } from '../session';

type SetOrder = (o: OrderDetail) => void;

const TRANSITIONS: Record<Role, Partial<Record<OrderStatus, OrderStatus[]>>> = {
  admin: { new: ['confirmed', 'delivered', 'cancelled'], confirmed: ['new', 'delivered', 'cancelled'], delivered: ['confirmed'], cancelled: ['new'] },
  producer: { new: ['confirmed', 'cancelled'], confirmed: ['delivered', 'cancelled'] },
  merchant: { new: ['cancelled'] },
};

const eur = (cents: number) => (cents / 100).toFixed(2);

// ─── Status ───

function StatusActions({ order, onDone }: { order: OrderDetail; onDone: SetOrder }) {
  const t = useTranslations('orders');
  const me = useMe();
  const action = useAction();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const next = TRANSITIONS[me.role][order.status] ?? [];
  if (!next.length) return null;
  const go = async (status: OrderStatus, why?: string) => {
    const r = await action.run(() => api<OrderDetail>(`/orders/${order.id}/status`, { method: 'PATCH', body: { status, reason: why ?? null } }));
    if (r) {
      onDone(r);
      setCancelling(false);
    }
  };
  return (
    <>
      {next.map((s) =>
        s === 'cancelled' ? (
          <Btn key={s} tone="danger" onClick={() => setCancelling(true)}>
            {t('actions.cancel')}
          </Btn>
        ) : (
          <Btn key={s} tone={s === 'confirmed' || s === 'delivered' ? 'primary' : 'default'} busy={action.busy} onClick={() => void go(s)}>
            {t(`actions.${s}`)}
          </Btn>
        ),
      )}
      {action.error && !cancelling ? <span className="self-center text-[13px] text-red-700">{action.error}</span> : null}
      <Modal title={t('actions.cancel')} open={cancelling} onClose={() => setCancelling(false)}>
        <div className="space-y-4">
          <Txt label={t('cancelReason')} value={reason} onChange={(e) => setReason(e.target.value)} />
          <ErrorNote>{action.error}</ErrorNote>
          <Btn tone="danger" busy={action.busy} onClick={() => void go('cancelled', reason)}>
            {t('actions.cancelConfirm')}
          </Btn>
        </div>
      </Modal>
    </>
  );
}

// ─── Lines ───

function RequestChange({ order, item, onDone }: { order: OrderDetail; item: OrderItem; onDone(): void }) {
  const t = useTranslations('requests');
  const f = useFmt();
  const action = useAction();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  if (!item.good_id) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await action.run(() =>
      api('/requests', { method: 'POST', body: { good_id: item.good_id, merchant_id: order.merchant_id, order_id: order.id, proposed_price: price || null, description } }),
    );
    if (r) {
      setOpen(false);
      setPrice('');
      setDescription('');
      onDone();
    }
  };
  return (
    <>
      <Btn size="sm" tone="ghost" onClick={() => setOpen(true)} title={t('ask')}>
        {t('askShort')}
      </Btn>
      <Modal title={`${t('ask')}: ${item.name_bg}`} open={open} onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-[14px] text-neutral-600">{t('currentPrice', { price: f.money(item.unit_price_cents) })}</p>
          <In label={t('proposed')} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} error={action.field('proposed_price')} hint={t('proposedHint')} />
          <Txt label={t('description')} value={description} onChange={(e) => setDescription(e.target.value)} error={action.field('description')} />
          <InfoNote>{t('onlyAdminHint')}</InfoNote>
          <ErrorNote>{action.error}</ErrorNote>
          <Btn tone="primary" type="submit" busy={action.busy}>
            {t('send')}
          </Btn>
        </form>
      </Modal>
    </>
  );
}

interface EditRow {
  id?: string;
  good_id: string;
  quantity: string;
  unit_price: string;
  vat_percent: string;
  /** A fixed commission per unit for this line, in euro. Empty: the order's commission. */
  commission_unit: string;
  /** The merchant's shop for this line; '' when the merchant has no shops. */
  shop_id: string;
}

/** Admin only: change lines, quantities, prices, the commission and returns. */
function AdminEdit({ order, onDone }: { order: OrderDetail; onDone: SetOrder }) {
  const t = useTranslations('orders');
  const tm = useTranslations('commissionTerms');
  const tc = useTranslations('common');
  const f = useFmt();
  const action = useAction();
  const [open, setOpen] = useState(false);
  const goods = useData<Good[]>(open ? `/goods?producer_id=${order.producer_id}` : null);
  const shops = useData<Shop[]>(open ? `/merchants/${order.merchant_id}/shops` : null);
  const hasShops = Boolean(shops.data?.length) || order.items.some((i) => i.shop_id);
  const init = (): EditRow[] => order.items.map((i) => ({ id: i.id, good_id: i.good_id ?? '', quantity: String(i.quantity_milli / 1000), unit_price: eur(i.unit_price_cents),
      vat_percent: String(i.vat_bp / 100),
      commission_unit: i.commission_unit_cents !== null && i.commission_unit_cents !== undefined ? eur(i.commission_unit_cents) : '',
      shop_id: i.shop_id ?? '',
    }));
  const [rows, setRows] = useState<EditRow[]>(init);
  const [commissionType, setCommissionType] = useState(order.commission_type ?? 'percent');
  const [commission, setCommission] = useState(String((order.commission_bp ?? 0) / 100));
  const [commissionUnit, setCommissionUnit] = useState(eur(order.commission_unit_cents ?? 0));
  const [returned, setReturned] = useState(eur(order.returned_net_cents));
  const [returnedNote, setReturnedNote] = useState(order.returned_note ?? '');
  const [updateAgreed, setUpdateAgreed] = useState(true);

  const num = (s: string) => Number(s.replace(',', '.'));
  const calc = calculateOrder({
    lines: rows.filter((r) => num(r.quantity) > 0).map((r) => ({ quantityMilli: qtyToMilli(num(r.quantity)), unitPriceCents: Math.round(num(r.unit_price) * 100) || 0, vatBp: Math.round(num(r.vat_percent) * 100) || 0,
        commissionUnitCents: r.commission_unit.trim() === '' ? null : Math.round(num(r.commission_unit) * 100) || 0,
      })),
    returnedNetCents: Math.round(num(returned) * 100) || 0,
    commissionType: commissionType as CommissionType,
    commissionBp: Math.round(num(commission) * 100) || 0,
    commissionUnitCents: Math.round(num(commissionUnit) * 100) || 0,
    payments: [],
    commissionPayments: [],
    today: todayIso(),
  });
  const set = (i: number, patch: Partial<EditRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await action.run(() =>
      api<OrderDetail>(`/orders/${order.id}`, {
        method: 'PUT',
        body: {
          items: rows.map((r) => ({ ...r, commission_unit: r.commission_unit.trim() === '' ? null : r.commission_unit, shop_id: r.shop_id || null })),
          commission_type: commissionType,
          commission_percent: commissionType === 'percent' ? commission : 0,
          commission_unit: commissionType === 'per_unit' ? commissionUnit : 0,
          returned_net: returned || 0, returned_note: returnedNote, update_agreed_prices: updateAgreed },
      }),
    );
    if (r) {
      onDone(r);
      setOpen(false);
    }
  };

  return (
    <>
      <Btn
        size="sm"
        onClick={() => {
          setRows(init());
          setOpen(true);
        }}
      >
        {t('editLines')}
      </Btn>
      <Modal title={t('editLines')} open={open} onClose={() => setOpen(false)} wide>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={r.id ?? `new-${i}`} className="grid grid-cols-2 gap-2 rounded-md border border-neutral-200 p-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
                <Sel className="col-span-2 sm:col-span-1" aria-label={t('good')} value={r.good_id} onChange={(e) => set(i, { good_id: e.target.value })} error={action.field(`items.${i}.good_id`)}>
                  <option value="">{tc('choose')}</option>
                  {(goods.data ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name_bg}
                    </option>
                  ))}
                  {r.good_id && !goods.data?.some((g) => g.id === r.good_id) ? <option value={r.good_id}>{order.items.find((x) => x.good_id === r.good_id)?.name_bg ?? '…'}</option> : null}
                </Sel>
                {hasShops ? (
                  <Sel className="col-span-2 sm:col-span-6" aria-label={t('shop')} value={r.shop_id} onChange={(e) => set(i, { shop_id: e.target.value })} error={action.field(`items.${i}.shop_id`)}>
                    <option value="">{t('noShop')}</option>
                    {(shops.data ?? []).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.alias} - {x.address}
                      </option>
                    ))}
                    {r.shop_id && !shops.data?.some((x) => x.id === r.shop_id) ? <option value={r.shop_id}>{order.items.find((x) => x.shop_id === r.shop_id)?.shop_alias ?? '…'}</option> : null}
                  </Sel>
                ) : null}
                <In aria-label={t('quantity')} placeholder={t('quantity')} inputMode="decimal" value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} error={action.field(`items.${i}.quantity`)} />
                <In aria-label={t('unitPrice')} placeholder={t('unitPrice')} inputMode="decimal" value={r.unit_price} onChange={(e) => set(i, { unit_price: e.target.value })} error={action.field(`items.${i}.unit_price`)} />
                <In aria-label={t('vat')} placeholder={t('vat')} inputMode="decimal" value={r.vat_percent} onChange={(e) => set(i, { vat_percent: e.target.value })} />
                <In
                  aria-label={tm('lineUnitAmount')}
                  title={tm('lineUnitHint')}
                  placeholder={tm('lineUnitAmount')}
                  inputMode="decimal"
                  value={r.commission_unit}
                  onChange={(e) => set(i, { commission_unit: e.target.value })}
                  error={action.field(`items.${i}.commission_unit`)}
                />
                <Btn size="sm" tone="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={tc('remove')}>
                  ✕
                </Btn>
              </div>
            ))}
            <Btn
              size="sm"
              onClick={() => {
                const g = goods.data?.[0];
                setRows([...rows, { good_id: g?.id ?? '', quantity: '1', unit_price: g ? eur(g.price_cents) : '0', vat_percent: g ? String(g.vat_bp / 100) : '20', commission_unit: g?.commission_unit_cents !== null && g?.commission_unit_cents !== undefined ? eur(g.commission_unit_cents) : '', shop_id: rows[rows.length - 1]?.shop_id ?? shops.data?.find((x) => x.active)?.id ?? '' }]);
              }}
            >
              + {t('addLine')}
            </Btn>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Sel label={tm('type')} value={commissionType} onChange={(e) => setCommissionType(e.target.value as CommissionType)}>
              {COMMISSION_TYPES.map((x) => (
                <option key={x} value={x}>
                  {tm(`types.${x}`)}
                </option>
              ))}
            </Sel>
            {commissionType === 'per_unit' ? (
              <In label={tm('unitAmount')} inputMode="decimal" value={commissionUnit} onChange={(e) => setCommissionUnit(e.target.value)} error={action.field('commission_unit')} />
            ) : (
              <In label={t('commissionPercent')} inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} error={action.field('commission_percent')} />
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <In label={t('returnedNet')} inputMode="decimal" value={returned} onChange={(e) => setReturned(e.target.value)} error={action.field('returned_net')} />
            <In label={t('returnedNote')} value={returnedNote} onChange={(e) => setReturnedNote(e.target.value)} />
          </div>
          <p className="text-[12px] text-neutral-500">{tm('lineUnitHint')}</p>
          <Check label={t('updateAgreed')} checked={updateAgreed} onChange={(e) => setUpdateAgreed(e.target.checked)} />
          <p className="text-[14px] text-neutral-700">
            {t('net')}: <strong>{f.money(calc.baseNetCents)}</strong> · {t('commission')}: <strong>{f.money(calc.commissionCents)}</strong>
          </p>
          <ErrorNote>{action.error}</ErrorNote>
          <Btn tone="primary" type="submit" busy={action.busy}>
            {tc('save')}
          </Btn>
        </form>
      </Modal>
    </>
  );
}

function ItemsCard({ order, onDone, reload }: { order: OrderDetail; onDone: SetOrder; reload(): void }) {
  const t = useTranslations('orders');
  const locale = useLocale();
  const me = useMe();
  const f = useFmt();
  const canAsk = me.role !== 'admin' && order.status !== 'cancelled';
  const withShops = order.items.some((i) => i.shop_alias);
  return (
    <Card title={t('goods')} actions={me.role === 'admin' ? <AdminEdit order={order} onDone={onDone} /> : null}>
      <Table head={[...(withShops ? [t('shop')] : []), t('good'), t('quantity'), t('unitPrice'), t('vat'), t('unitPriceGross'), t('lineNet'), t('lineGross'), ...(canAsk ? [''] : [])]}>
        {order.items.map((i) => (
          <tr key={i.id}>
            {withShops ? (
              <td className={td}>
                <div className="font-medium">{i.shop_alias ?? '-'}</div>
                {i.shop_address ? <div className="text-[12px] text-neutral-500">{i.shop_address}</div> : null}
              </td>
            ) : null}
            <td className={td}>
              <div className="font-medium">{locale === 'en' && i.name_en ? i.name_en : i.name_bg}</div>
              {i.sku ? <div className="text-[12px] text-neutral-500">{i.sku}</div> : null}
            </td>
            <td className={tdNum}>{f.qty(i.quantity_milli, i.unit)}</td>
            <td className={tdNum}>{f.money(i.unit_price_cents)}</td>
            <td className={tdNum}>{f.pct(i.vat_bp)}</td>
            <td className={tdNum}>{f.money(i.unit_price_gross_cents)}</td>
            <td className={tdNum}>{f.money(i.line_net_cents)}</td>
            <td className={tdNum}>{f.money(i.line_gross_cents)}</td>
            {canAsk ? (
              <td className={`${td} text-right`}>
                <RequestChange order={order} item={i} onDone={reload} />
              </td>
            ) : null}
          </tr>
        ))}
      </Table>
      {me.role !== 'admin' ? <p className="mt-2 text-[12px] text-neutral-500">{t('priceLockHint')}</p> : null}
    </Card>
  );
}

// ─── Totals ───

function TotalsCard({ order }: { order: OrderDetail }) {
  const t = useTranslations('orders');
  const f = useFmt();
  const me = useMe();
  const c = order.calc;
  const items: [ReactNode, ReactNode][] = [
    [t('net'), f.money(c.netCents)],
    [t('vatAmount'), f.money(c.vatCents)],
    [t('gross'), f.money(c.grossCents)],
  ];
  if (c.returnedNetCents) items.push([t('returnedNet'), `- ${f.money(c.returnedNetCents)}`]);
  items.push([t('payable'), <strong key="p">{f.money(c.payableGrossCents)}</strong>], [t('paid'), f.money(c.paidCents)], [t('payment'), <PaymentBadge key="s" status={c.paymentStatus} />]);
  return (
    <Card title={t('summary')}>
      <Facts items={items} />
      {me.role !== 'merchant' && c.commissionCents !== undefined ? (
        <div className="mt-4 border-t border-neutral-100 pt-4">
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-neutral-600">{t('commission')}</h3>
          <Facts
            items={[
              [t('commissionBase'), f.money(c.baseNetCents)],
              [t('commissionRate'), f.commission(c.commissionType, c.commissionBp, c.commissionUnitCents, c.commissionByGoods)],
              [t('commission'), <strong key="c">{f.money(c.commissionCents)}</strong>],
              [t('accrued'), f.money(c.commissionAccruedCents)],
              [t('received'), f.money(c.commissionReceivedCents)],
              [t('outstanding'), f.money(c.commissionOutstandingCents)],
              ...(c.commissionOverdueCents ? ([[t('overdue'), <span key="o" className="font-semibold text-red-700">{f.money(c.commissionOverdueCents)}</span>]] as [ReactNode, ReactNode][]) : []),
              [t('nextDue'), f.date(c.commissionNextDueOn)],
              [t('status'), <CommissionBadge key="st" status={c.commissionStatus} />],
            ]}
          />
          <p className="mt-3 text-[12px] text-neutral-500">{t('commissionRule')}</p>
        </div>
      ) : null}
    </Card>
  );
}

// ─── Delivery ───

function DeliveryCard({ order, onDone }: { order: OrderDetail; onDone: SetOrder }) {
  const t = useTranslations('orders');
  const td_ = useTranslations('deliveryMethods');
  const tc = useTranslations('common');
  const f = useFmt();
  const me = useMe();
  const action = useAction();
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ delivery_method: order.delivery_method, delivery_note: order.delivery_note ?? '', planned_delivery_on: order.planned_delivery_on ?? '', delivered_on: order.delivered_on ?? '' });
  const canEdit = (me.role === 'admin' || me.role === 'producer') && order.status !== 'cancelled';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await action.run(() => api<OrderDetail>(`/orders/${order.id}/delivery`, { method: 'PUT', body: form }));
    if (r) {
      onDone(r);
      setEdit(false);
    }
  };
  return (
    <Card
      title={t('delivery')}
      actions={
        canEdit && !edit ? (
          <Btn size="sm" onClick={() => setEdit(true)}>
            {tc('edit')}
          </Btn>
        ) : null
      }
    >
      {edit ? (
        <form onSubmit={submit} className="space-y-3">
          <Sel label={t('deliveryMethod')} value={form.delivery_method} onChange={(e) => setForm({ ...form, delivery_method: e.target.value })}>
            {DELIVERY_METHODS.map((m) => (
              <option key={m} value={m}>
                {td_(m)}
              </option>
            ))}
          </Sel>
          <Txt label={t('deliveryNote')} value={form.delivery_note} onChange={(e) => setForm({ ...form, delivery_note: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <In type="date" label={t('plannedDelivery')} value={form.planned_delivery_on} onChange={(e) => setForm({ ...form, planned_delivery_on: e.target.value })} error={action.field('planned_delivery_on')} />
            <In type="date" label={t('deliveredOn')} value={form.delivered_on} onChange={(e) => setForm({ ...form, delivered_on: e.target.value })} error={action.field('delivered_on')} hint={t('deliveredHint')} />
          </div>
          <ErrorNote>{action.error}</ErrorNote>
          <div className="flex gap-2">
            <Btn tone="primary" type="submit" busy={action.busy}>
              {tc('save')}
            </Btn>
            <Btn onClick={() => setEdit(false)}>{tc('cancel')}</Btn>
          </div>
        </form>
      ) : (
        <Facts
          items={[
            [t('deliveryMethod'), td_(order.delivery_method as never)],
            [t('deliveryNote'), order.delivery_note],
            [t('requestedDelivery'), f.date(order.requested_delivery_on)],
            [t('plannedDelivery'), f.date(order.planned_delivery_on)],
            [t('deliveredOn'), f.date(order.delivered_on)],
            [t('receiving'), order.merchant.delivery_note],
          ]}
        />
      )}
    </Card>
  );
}

// ─── Money ───

function PaymentsCard({ order, onDone, kind }: { order: OrderDetail; onDone: SetOrder; kind: 'payments' | 'commission-payments' }) {
  const t = useTranslations('orders');
  const tc = useTranslations('common');
  const f = useFmt();
  const me = useMe();
  const action = useAction();
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso());
  const [note, setNote] = useState('');
  const list = (kind === 'payments' ? order.payments : order.commission_payments) ?? [];
  // Merchant payments: the producer's business. Commission received: the admin's.
  const canEdit = kind === 'payments' ? me.role === 'producer' && order.status !== 'cancelled' : me.role === 'admin';
  const suggested = kind === 'payments' ? order.calc.payableGrossCents - order.calc.paidCents : (order.calc.commissionOutstandingCents ?? 0);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const r = await action.run(() => api<OrderDetail>(`/orders/${order.id}/${kind}`, { method: 'POST', body: { amount, paid_on: paidOn, note } }));
    if (r) {
      onDone(r);
      setAmount('');
      setNote('');
    }
  };
  const remove = async (pid: string) => {
    const r = await action.run(() => api<OrderDetail>(`/orders/${order.id}/${kind}/${pid}`, { method: 'DELETE' }));
    if (r) onDone(r);
  };
  // What is left of the commission, whether or not the merchant has paid yet.
  const rest = kind === 'commission-payments' ? Math.max(0, (order.calc.commissionCents ?? 0) - (order.calc.commissionReceivedCents ?? 0)) : 0;
  const markPaid = async () => {
    const r = await action.run(() => api<OrderDetail>(`/orders/${order.id}/commission-payments`, { method: 'POST', body: { amount: eur(rest), paid_on: todayIso(), note: '' } }));
    if (r) onDone(r);
  };

  return (
    <Card title={kind === 'payments' ? t('merchantPayments') : t('commissionPayments')}>
      <p className="mb-3 text-[13px] text-neutral-500">{kind === 'payments' ? t('merchantPaymentsHint') : t('commissionPaymentsHint')}</p>
      {canEdit && rest > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-green-200 bg-green-50 p-3">
          <Btn tone="primary" busy={action.busy} onClick={() => void markPaid()}>
            {t('markCommissionPaid', { amount: f.money(rest) })}
          </Btn>
          <span className="text-[12px] text-neutral-600">{t('markCommissionPaidHint')}</span>
        </div>
      ) : null}
      {list.length ? (
        <ul className="mb-3 divide-y divide-neutral-100 text-[14px]">
          {list.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <strong className="tabular-nums">{f.money(p.amount_cents)}</strong> · {f.date(p.paid_on)}
                {p.note ? <span className="text-neutral-500"> · {p.note}</span> : null}
              </span>
              {canEdit ? <ConfirmBtn onConfirm={() => void remove(p.id)}>{tc('delete')}</ConfirmBtn> : null}
            </li>
          ))}
        </ul>
      ) : (
        <Empty />
      )}
      {canEdit ? (
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
          <In label={t('amount')} inputMode="decimal" value={amount} placeholder={suggested > 0 ? eur(suggested) : ''} onChange={(e) => setAmount(e.target.value)} error={action.field('amount')} />
          <In type="date" label={t('paidOn')} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} error={action.field('paid_on')} />
          <In label={t('paymentNote')} value={note} onChange={(e) => setNote(e.target.value)} />
          <Btn type="submit" tone="primary" busy={action.busy}>
            {tc('add')}
          </Btn>
        </form>
      ) : null}
      {action.error ? (
        <div className="mt-2">
          <ErrorNote>{action.error}</ErrorNote>
        </div>
      ) : null}
    </Card>
  );
}

function ReturnCard({ order, onDone }: { order: OrderDetail; onDone: SetOrder }) {
  const t = useTranslations('orders');
  const tc = useTranslations('common');
  const f = useFmt();
  const action = useAction();
  const [amount, setAmount] = useState(eur(order.returned_net_cents));
  const [note, setNote] = useState(order.returned_note ?? '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await action.run(() => api<OrderDetail>(`/orders/${order.id}/return`, { method: 'PUT', body: { returned_net: amount || 0, returned_note: note } }));
    if (r) onDone(r);
  };
  return (
    <Card title={t('returns')}>
      <p className="mb-3 text-[13px] text-neutral-500">{t('returnsHint')}</p>
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <In label={t('returnedNet')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={action.field('returned_net')} hint={order.returned_net_cents ? f.money(order.returned_net_cents) : undefined} />
        <In label={t('returnedNote')} value={note} onChange={(e) => setNote(e.target.value)} />
        <Btn type="submit" busy={action.busy}>
          {tc('save')}
        </Btn>
      </form>
      {action.error ? <ErrorNote>{action.error}</ErrorNote> : null}
    </Card>
  );
}

// ─── Requests and history ───

function RequestsCard({ order }: { order: OrderDetail }) {
  const t = useTranslations('requests');
  const f = useFmt();
  if (!order.requests.length) return null;
  return (
    <Card title={t('title')} actions={<Link href="/requests" className="text-[13px] text-neutral-600 hover:underline">{t('all')}</Link>}>
      <ul className="divide-y divide-neutral-100 text-[14px]">
        {order.requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              №{r.number} · {r.good_name}: {f.money(r.current_price_cents)}
              {r.proposed_price_cents !== null ? ` → ${f.money(r.proposed_price_cents)}` : ''}
              {r.new_price_cents !== null ? ` (${f.money(r.new_price_cents)})` : ''}
            </span>
            <RequestBadge status={r.status} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function HistoryCard({ order }: { order: OrderDetail }) {
  const t = useTranslations('events');
  const tr = useTranslations('roles');
  const ts = useTranslations('orderStatus');
  const f = useFmt();
  const describe = (e: OrderDetail['events'][number]) => {
    const d = e.data;
    switch (e.type) {
      case 'status':
        return t('status', { from: ts(d.from as never), to: ts(d.to as never) });
      case 'payment':
      case 'payment_deleted':
      case 'commission_payment':
      case 'commission_payment_deleted':
        return t(e.type, { amount: f.money(d.amount as number), date: f.date(d.paid_on as string) });
      case 'edited':
        return t('edited', { before: f.money(d.before as number), after: f.money(d.after as number) });
      case 'returned':
        return t('returned', { amount: f.money(d.amount as number) });
      case 'created':
        return t('created', { amount: f.money(d.net as number) });
      default:
        return t(e.type as 'delivery');
    }
  };
  return (
    <Card title={t('title')}>
      <ul className="space-y-2 text-[13px]">
        {order.events.map((e) => (
          <li key={e.id} className="flex flex-wrap gap-x-2">
            <span className="text-neutral-500">{f.dateTime(e.created_at)}</span>
            <span className="font-medium">{e.user_name ?? e.user_email ?? tr(e.role)}</span>
            <span>{describe(e)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ─── Page ───

export function OrderDetailView({ id }: { id: string }) {
  const t = useTranslations('orders');
  const tc = useTranslations('common');
  const f = useFmt();
  const me = useMe();
  const router = useRouter();
  const tr = useTranslations('roles');
  const state = useData<OrderDetail>(`/orders/${id}`);
  const remove = useAction();
  if (state.error) return <ErrorNote>{state.error}</ErrorNote>;
  const order = state.data;
  if (!order) return <p className="py-10 text-center text-[14px] text-neutral-500">{tc('loading')}</p>;
  const set: SetOrder = (o) => state.setData(o);

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/orders" className="text-[13px] text-neutral-500 hover:underline">
            ← {t('title')}
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {t('orderNo', { number: order.number })} <OrderStatusBadge status={order.status} />
          </h1>
          <p className="mt-1 text-[14px] text-neutral-600">
            {f.date(order.order_date)}
            {order.merchant_ref ? ` · ${t('merchantRef')}: ${order.merchant_ref}` : ''} · {t('createdBy', { role: tr(order.created_by_role) })}
          </p>
          {order.cancel_reason ? <p className="mt-1 text-[14px] text-red-700">{t('cancelReason')}: {order.cancel_reason}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusActions order={order} onDone={set} />
          {me.role === 'admin' ? (
            <ConfirmBtn
              size="md"
              busy={remove.busy}
              onConfirm={async () => {
                if (await remove.run(() => api(`/orders/${order.id}`, { method: 'DELETE' }))) router.replace('/orders');
              }}
            >
              {tc('delete')}
            </ConfirmBtn>
          ) : null}
        </div>
      </div>
      {remove.error ? (
        <div className="mb-4">
          <ErrorNote>{remove.error}</ErrorNote>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card title={t('producer')}>
              <Facts
                items={[
                  [t('name'), me.role === 'admin' ? <Link key="p" href={`/producers/${order.producer.id}`} className="text-ink hover:underline">{order.producer.name}</Link> : order.producer.name],
                  ['ЕИК', order.producer.eik],
                  [t('phone'), order.producer.phone],
                  [t('email'), order.producer.email],
                ]}
              />
            </Card>
            <Card title={t('merchant')}>
              <Facts
                items={[
                  [t('name'), me.role !== 'merchant' ? <Link key="m" href={`/merchants/${order.merchant.id}`} className="text-ink hover:underline">{order.merchant.name}</Link> : order.merchant.name],
                  ['ЕИК', order.merchant.eik],
                  [t('phone'), order.merchant.phone],
                  [t('address'), order.merchant.address],
                  ...(order.shop_aliases ? ([[t('shops'), order.shop_aliases]] as [ReactNode, ReactNode][]) : []),
                ]}
              />
            </Card>
          </div>
          <ItemsCard order={order} onDone={set} reload={state.reload} />
          {order.note ? (
            <Card title={t('note')}>
              <p className="whitespace-pre-line text-[14px]">{order.note}</p>
            </Card>
          ) : null}
          <DeliveryCard key={`d-${order.updated_at}`} order={order} onDone={set} />
          <PaymentsCard order={order} onDone={set} kind="payments" />
          {me.role !== 'merchant' ? <PaymentsCard order={order} onDone={set} kind="commission-payments" /> : null}
          {me.role === 'producer' ? <ReturnCard key={`r-${order.updated_at}`} order={order} onDone={set} /> : null}
          <RequestsCard order={order} />
        </div>
        <div className="space-y-6">
          <TotalsCard order={order} />
          <HistoryCard order={order} />
        </div>
      </div>
    </>
  );
}
