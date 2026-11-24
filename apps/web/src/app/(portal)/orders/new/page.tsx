'use client';

import { calculateOrder, lineAmounts, qtyToMilli, unitGrossCents } from '@ba/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useRef, useState } from 'react';
import { Btn, Card, Empty, ErrorNote, Facts, In, InfoNote, Loading, PageHeader, Sel, Table, td, tdNum, todayIso, Txt, useAction, useData, useFmt } from '@/components/kit';
import { useMe } from '@/components/session';
import { api } from '@/lib/api-client';
import type { AgreedPrice, Good, Merchant, Producer, Shop } from '@/lib/types';

/** One row of a box: a good, its quantity and (for the admin) its price in euro. */
interface Row {
  key: number;
  goodId: string;
  qty: string;
  price: string;
}

/** One box: the goods for one shop of the merchant ('' when the merchant has no shops). */
interface Box {
  key: number;
  shopId: string;
  rows: Row[];
}

const num = (v: string) => Number(v.trim().replace(',', '.'));

function NewOrder() {
  const t = useTranslations('orders');
  const tc = useTranslations('common');
  const me = useMe();
  const locale = useLocale();
  const f = useFmt();
  const router = useRouter();
  const sp = useSearchParams();
  const action = useAction();
  const admin = me.role === 'admin';
  // The producer's current (wanted) price: for the admin and the producer, not for merchants.
  const showWanted = me.role !== 'merchant';

  const [producerId, setProducerId] = useState(me.role === 'producer' ? me.producer_id! : (sp.get('producer_id') ?? ''));
  const [merchantId, setMerchantId] = useState(me.role === 'merchant' ? me.merchant_id! : (sp.get('merchant_id') ?? ''));
  const [orderDate, setOrderDate] = useState(todayIso());
  const [ref, setRef] = useState('');
  const [requested, setRequested] = useState('');
  const [note, setNote] = useState('');

  // Unique keys for boxes and rows.
  const seq = useRef(1);
  const next = () => seq.current++;
  const emptyRow = (): Row => ({ key: next(), goodId: '', qty: '', price: '' });
  const [boxes, setBoxes] = useState<Box[]>([]);

  const producers = useData<Producer[]>(me.role === 'producer' ? null : '/producers');
  const merchants = useData<Merchant[]>(me.role === 'merchant' ? null : '/merchants');
  const goods = useData<Good[]>(producerId ? `/goods?producer_id=${producerId}` : null);
  const shopsState = useData<Shop[]>(merchantId ? `/merchants/${merchantId}/shops` : null);
  const shops = (shopsState.data ?? []).filter((x) => x.active);
  const hasShops = shops.length > 0;
  const agreed = useData<AgreedPrice[]>(me.role !== 'merchant' && producerId && merchantId ? `/agreed-prices?producer_id=${producerId}&merchant_id=${merchantId}` : null);

  // A merchant charged 0% VAT gets VAT 0 on every line (for a merchant the API already sends VAT 0).
  const zeroVat = me.role !== 'merchant' && Boolean(merchants.data?.find((m) => m.id === merchantId)?.zero_vat);
  const vatOf = (g: Good) => (zeroVat ? 0 : g.vat_bp);

  const available = (goods.data ?? []).filter((g) => g.active || admin);
  const goodOf = (id: string) => available.find((g) => g.id === id);

  /** The default price: the merchant's agreed price (the price of its last order), else the producer's list price. */
  const defaultOf = (g: Good) => {
    if (me.role === 'merchant') return { cents: g.my_price_cents ?? g.price_cents, locked: Boolean(g.price_locked) };
    const a = agreed.data?.find((x) => x.good_id === g.id);
    return a ? { cents: a.price_cents, locked: true } : { cents: g.price_cents, locked: false };
  };
  /** The price a row gets: what the admin typed, else the default. */
  const priceOf = (r: Row, g: Good) => {
    const n = num(r.price);
    return admin && r.price.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : defaultOf(g).cents;
  };

  /** A row's totals: price incl. VAT per unit x quantity, then the total excl. VAT out of it (as the saved order). */
  const amounts = (r: Row, g: Good, q: number) => lineAmounts(qtyToMilli(q), priceOf(r, g), vatOf(g));

  // A merchant without shops has a single box with no shop, there from the start.
  const shown: Box[] = hasShops || !merchantId || shopsState.loading ? boxes : boxes.length ? boxes.slice(0, 1) : [{ key: 0, shopId: '', rows: [{ key: 0, goodId: '', qty: '', price: '' }] }];

  const update = (box: Box, patch: (b: Box) => Box) => setBoxes((boxes.length ? boxes : shown).map((b) => (b.key === box.key ? patch(b) : b)));
  const setRow = (box: Box, row: Row, patch: Partial<Row>) =>
    update(box, (b) => {
      let rows = b.rows.map((r) => (r.key === row.key ? { ...r, ...patch } : r));
      // Picking a good in the last row opens a new empty row below it.
      if (patch.goodId && rows[rows.length - 1]?.goodId) rows = [...rows, emptyRow()];
      return { ...b, rows };
    });
  const removeRow = (box: Box, row: Row) =>
    update(box, (b) => {
      const rows = b.rows.filter((r) => r.key !== row.key);
      // There is always one empty row at the end to add the next good.
      return { ...b, rows: rows.length && rows[rows.length - 1]!.goodId === '' ? rows : [...rows, emptyRow()] };
    });

  // Every row with a good and a quantity becomes an order line.
  const lines = shown.flatMap((b) =>
    b.rows.flatMap((r) => {
      const g = goodOf(r.goodId);
      const q = num(r.qty);
      return g && Number.isFinite(q) && q > 0 && (!hasShops || b.shopId) ? [{ box: b, r, g, q }] : [];
    }),
  );
  /** Quantities added up per unit (pieces and kilograms are never added together), e.g. "300 бр. + 5 кг". */
  const qtyText = (items: { g: Good; q: number }[]) => {
    const by = new Map<string, number>();
    for (const { g, q } of items) by.set(g.unit, (by.get(g.unit) ?? 0) + qtyToMilli(q));
    return [...by].map(([unit, milli]) => f.qty(milli, unit)).join(' + ');
  };

  const calc = calculateOrder({
    lines: lines.map((l) => ({ quantityMilli: qtyToMilli(l.q), unitPriceCents: priceOf(l.r, l.g), vatBp: vatOf(l.g) })),
    commissionBp: 0,
    payments: [],
    commissionPayments: [],
    today: todayIso(),
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await action.run(() =>
      api<{ id: string }>('/orders', {
        method: 'POST',
        body: {
          producer_id: me.role === 'producer' ? undefined : producerId || undefined,
          merchant_id: me.role === 'merchant' ? undefined : merchantId || undefined,
          order_date: orderDate,
          merchant_ref: ref,
          requested_delivery_on: requested,
          note,
          items: lines.map((l) => ({
            good_id: l.g.id,
            quantity: l.q,
            ...(l.box.shopId ? { shop_id: l.box.shopId } : {}),
            ...(admin ? { unit_price: priceOf(l.r, l.g) / 100 } : {}),
          })),
        },
      }),
    );
    if (r) router.replace(`/orders/${r.id}`);
  };

  const producer = producers.data?.find((p) => p.id === producerId);
  const usedShops = new Set(boxes.map((b) => b.shopId).filter(Boolean));
  // Another box can be added while there is a shop left to pick.
  const canAddBox = hasShops && boxes.length < shops.length;

  const boxCard = (box: Box, index: number) => {
    const shop = shops.find((x) => x.id === box.shopId);
    const boxNet = box.rows.reduce((s, r) => {
      const g = goodOf(r.goodId);
      const q = num(r.qty);
      return g && q > 0 ? s + amounts(r, g, q).netCents : s;
    }, 0);
    const boxGross = box.rows.reduce((s, r) => {
      const g = goodOf(r.goodId);
      const q = num(r.qty);
      return g && q > 0 ? s + amounts(r, g, q).grossCents : s;
    }, 0);
    return (
      <div key={box.key} className="rounded-md border border-neutral-200 bg-white p-3 shadow-sm">
        {hasShops ? (
          <div className="mb-3 flex items-end gap-2">
            <Sel className="min-w-0 flex-1" label={`${t('shop')} ${index + 1}`} value={box.shopId} onChange={(e) => update(box, (b) => ({ ...b, shopId: e.target.value }))} required>
              <option value="">{tc('choose')}</option>
              {shops
                .filter((x) => x.id === box.shopId || !usedShops.has(x.id))
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.alias} - {x.address}
                  </option>
                ))}
            </Sel>
            <Btn onClick={() => setBoxes(boxes.filter((b) => b.key !== box.key))} aria-label={t('removeShop')} title={t('removeShop')}>
              −
            </Btn>
          </div>
        ) : null}
        {hasShops && !shop ? (
          <p className="text-[13px] text-neutral-500">{t('chooseShopFirst')}</p>
        ) : (
          <>
            <Table head={[t('good'), ...(showWanted ? [t('wantedPrice')] : []), t('unitNet'), t('vat'), t('unitGross'), t('quantity'), t('totalNet'), t('totalGross'), '']}>
              {box.rows.map((r) => {
                const g = goodOf(r.goodId);
                const q = num(r.qty);
                return (
                  <tr key={r.key}>
                    <td className={`${td} min-w-48`}>
                      <Sel
                        aria-label={t('good')}
                        value={r.goodId}
                        // The good fills in its price by the usual rules.
                        onChange={(e) => {
                          const ng = goodOf(e.target.value);
                          setRow(box, r, { goodId: e.target.value, price: ng ? (defaultOf(ng).cents / 100).toFixed(2) : '' });
                        }}
                      >
                        <option value="">{tc('choose')}</option>
                        {available.map((x) => (
                          <option key={x.id} value={x.id}>
                            {locale === 'en' && x.name_en ? x.name_en : x.name_bg}
                          </option>
                        ))}
                      </Sel>
                    </td>
                    {/* The good's current price (the producer's), for information only. */}
                    {showWanted ? (
                      <td className={`${tdNum} text-neutral-500`} title={t('wantedPriceHint')}>
                        {g ? f.money(g.price_cents) : ''}
                      </td>
                    ) : null}
                    {g && admin ? (
                      <td className={`${td} w-32`}>
                        <In inputMode="decimal" value={r.price} onChange={(e) => setRow(box, r, { price: e.target.value })} aria-label={t('unitNet')} hint={f.unit(g.unit)} />
                      </td>
                    ) : (
                      <td className={tdNum}>
                        {g ? (
                          <>
                            {f.money(priceOf(r, g))} / {f.unit(g.unit)}
                            {defaultOf(g).locked ? <div className="text-[11px] text-gold">{t('lockedPrice')}</div> : null}
                          </>
                        ) : null}
                      </td>
                    )}
                    <td className={tdNum}>{g ? f.pct(vatOf(g)) : ''}</td>
                    <td className={tdNum}>{g ? f.money(unitGrossCents(priceOf(r, g), vatOf(g))) : ''}</td>
                    <td className={`${td} w-28`}>
                      <In inputMode="decimal" value={r.qty} onChange={(e) => setRow(box, r, { qty: e.target.value })} aria-label={t('quantity')} placeholder="0" disabled={!g} />
                    </td>
                    <td className={tdNum}>{g && q > 0 ? f.money(amounts(r, g, q).netCents) : ''}</td>
                    <td className={`${tdNum} font-medium`}>{g && q > 0 ? f.money(amounts(r, g, q).grossCents) : ''}</td>
                    <td className={`${td} w-10 text-right`}>
                      {r.goodId ? (
                        <Btn size="sm" tone="ghost" onClick={() => removeRow(box, r)} aria-label={t('removeLine')} title={t('removeLine')}>
                          −
                        </Btn>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </Table>
            {boxGross ? (
              <p className="mt-2 text-right text-[13px] text-neutral-600">
                {t('quantity')}: {qtyText(lines.filter((l) => l.box.key === box.key))} · {t('net')}: {f.money(boxNet)} · {t('gross')}: <strong>{f.money(boxGross)}</strong>
              </p>
            ) : null}
          </>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={submit}>
      <PageHeader title={t('new')} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <Card title={t('parties')}>
            <div className="grid gap-4 sm:grid-cols-2">
              {me.role !== 'producer' ? (
                <Sel
                  label={t('producer')}
                  value={producerId}
                  onChange={(e) => {
                    setProducerId(e.target.value);
                    setBoxes([]);
                  }}
                  error={action.field('producer_id')}
                  required
                >
                  <option value="">{tc('choose')}</option>
                  {(producers.data ?? [])
                    .filter((p) => p.active || admin)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </Sel>
              ) : null}
              {me.role !== 'merchant' ? (
                <Sel
                  label={t('merchant')}
                  value={merchantId}
                  onChange={(e) => {
                    setMerchantId(e.target.value);
                    setBoxes([]);
                  }}
                  error={action.field('merchant_id')}
                  hint={me.role === 'producer' ? t('producerMerchantHint') : undefined}
                  required
                >
                  <option value="">{tc('choose')}</option>
                  {(merchants.data ?? [])
                    .filter((m) => m.active || admin)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </Sel>
              ) : null}
              <In type="date" label={t('date')} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} error={action.field('order_date')} required />
              <In label={t('merchantRef')} value={ref} onChange={(e) => setRef(e.target.value)} hint={t('merchantRefHint')} />
              <In type="date" label={t('requestedDelivery')} value={requested} onChange={(e) => setRequested(e.target.value)} />
            </div>
            {producer && me.role === 'merchant' ? (
              <div className="mt-4 text-[13px] text-neutral-600">
                <Facts items={[[t('producerContact'), [producer.phone, producer.email].filter(Boolean).join(' · ')]]} />
              </div>
            ) : null}
            {zeroVat ? (
              <div className="mt-4">
                <InfoNote>{t('zeroVat')}</InfoNote>
              </div>
            ) : null}
          </Card>

          <Card title={t('goods')}>
            {!producerId ? (
              <Empty>{t('chooseProducer')}</Empty>
            ) : !merchantId ? (
              <Empty>{t('chooseMerchant')}</Empty>
            ) : (goods.loading && !goods.data) || shopsState.loading ? (
              <Loading />
            ) : !available.length ? (
              <Empty>{t('noGoods')}</Empty>
            ) : (
              <div className="space-y-4">
                {shown.map(boxCard)}
                {hasShops && !boxes.length ? <p className="text-[13px] text-neutral-500">{t('addShopHint')}</p> : null}
                {canAddBox ? (
                  <Btn tone="primary" onClick={() => setBoxes([...boxes, { key: next(), shopId: '', rows: [emptyRow()] }])}>
                    + {t('addShop')}
                  </Btn>
                ) : null}
              </div>
            )}
            <p className="mt-3 text-[12px] text-neutral-500">{admin ? t('adminPriceHint') : t('priceLockHint')}</p>
            {action.field('items') ? <p className="mt-2 text-[13px] text-red-600">{action.field('items')}</p> : null}
            {action.field('shop_id') ? <p className="mt-2 text-[13px] text-red-600">{action.field('shop_id')}</p> : null}
          </Card>

          <Card title={t('note')}>
            <Txt value={note} onChange={(e) => setNote(e.target.value)} />
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card title={t('summary')}>
            <Facts
              items={[
                [t('lines'), lines.length],
                [t('quantity'), lines.length ? qtyText(lines) : '-'],
                [t('net'), f.money(calc.netCents)],
                [t('vatAmount'), f.money(calc.vatCents)],
                [t('gross'), <strong key="g">{f.money(calc.grossCents)}</strong>],
              ]}
            />
          </Card>
          {me.role !== 'admin' ? <InfoNote>{t('notifyHint')}</InfoNote> : null}
          <ErrorNote>{action.error}</ErrorNote>
          <Btn tone="primary" type="submit" busy={action.busy} disabled={!lines.length || !producerId || !merchantId} className="w-full">
            {t('create')}
          </Btn>
        </div>
      </div>
    </form>
  );
}

export default function NewOrderPage() {
  return (
    <Suspense>
      <NewOrder />
    </Suspense>
  );
}
