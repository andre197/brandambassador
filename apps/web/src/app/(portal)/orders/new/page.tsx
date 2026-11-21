'use client';

import { calculateOrder, qtyToMilli } from '@ba/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useMemo, useState } from 'react';
import { Btn, Card, Empty, ErrorNote, Facts, In, InfoNote, Loading, PageHeader, Sel, Table, td, tdNum, todayIso, Txt, useAction, useData, useFmt } from '@/components/kit';
import { useMe } from '@/components/session';
import { api } from '@/lib/api-client';
import type { AgreedPrice, Good, Merchant, Producer } from '@/lib/types';

function NewOrder() {
  const t = useTranslations('orders');
  const tc = useTranslations('common');
  const me = useMe();
  const locale = useLocale();
  const f = useFmt();
  const router = useRouter();
  const sp = useSearchParams();
  const action = useAction();

  const [producerId, setProducerId] = useState(me.role === 'producer' ? me.producer_id! : (sp.get('producer_id') ?? ''));
  const [merchantId, setMerchantId] = useState(me.role === 'merchant' ? me.merchant_id! : (sp.get('merchant_id') ?? ''));
  const [orderDate, setOrderDate] = useState(todayIso());
  const [ref, setRef] = useState('');
  const [requested, setRequested] = useState('');
  const [note, setNote] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});

  const producers = useData<Producer[]>(me.role === 'producer' ? null : '/producers');
  const merchants = useData<Merchant[]>(me.role === 'merchant' ? null : '/merchants');
  const goods = useData<Good[]>(producerId ? `/goods?producer_id=${producerId}` : null);
  const agreed = useData<AgreedPrice[]>(me.role !== 'merchant' && producerId && merchantId ? `/agreed-prices?producer_id=${producerId}&merchant_id=${merchantId}` : null);

  /** The price the order will get: the merchant's locked price, else the list price. */
  const priceOf = (g: Good) => {
    if (me.role === 'merchant') return { cents: g.my_price_cents ?? g.price_cents, locked: Boolean(g.price_locked) };
    const a = agreed.data?.find((x) => x.good_id === g.id);
    return a ? { cents: a.price_cents, locked: true } : { cents: g.price_cents, locked: false };
  };
  const available = (goods.data ?? []).filter((g) => g.active || me.role === 'admin');
  const lines = available
    .map((g) => ({ g, q: Number((qty[g.id] ?? '').replace(',', '.')) }))
    .filter((l) => Number.isFinite(l.q) && l.q > 0);
  const calc = useMemo(
    () => calculateOrder({ lines: lines.map((l) => ({ quantityMilli: qtyToMilli(l.q), unitPriceCents: priceOf(l.g).cents, vatBp: l.g.vat_bp })), commissionBp: 0, payments: [], commissionPayments: [], today: todayIso() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qty, goods.data, agreed.data],
  );

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
          items: lines.map((l) => ({ good_id: l.g.id, quantity: l.q })),
        },
      }),
    );
    if (r) router.replace(`/orders/${r.id}`);
  };

  const producer = producers.data?.find((p) => p.id === producerId);

  return (
    <form onSubmit={submit}>
      <PageHeader title={t('new')} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card title={t('parties')}>
            <div className="grid gap-4 sm:grid-cols-2">
              {me.role !== 'producer' ? (
                <Sel
                  label={t('producer')}
                  value={producerId}
                  onChange={(e) => {
                    setProducerId(e.target.value);
                    setQty({});
                  }}
                  error={action.field('producer_id')}
                  required
                >
                  <option value="">{tc('choose')}</option>
                  {(producers.data ?? [])
                    .filter((p) => p.active || me.role === 'admin')
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
                  onChange={(e) => setMerchantId(e.target.value)}
                  error={action.field('merchant_id')}
                  hint={me.role === 'producer' ? t('producerMerchantHint') : undefined}
                  required
                >
                  <option value="">{tc('choose')}</option>
                  {(merchants.data ?? [])
                    .filter((m) => m.active || me.role === 'admin')
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
                <Facts items={[[t('producerContact'), `${producer.phone} · ${producer.email}`]]} />
              </div>
            ) : null}
          </Card>

          <Card title={t('goods')}>
            {!producerId ? (
              <Empty>{t('chooseProducer')}</Empty>
            ) : goods.loading && !goods.data ? (
              <Loading />
            ) : available.length ? (
              <>
                <Table head={[t('good'), t('unitPrice'), t('vat'), t('quantity'), t('lineNet')]}>
                  {available.map((g) => {
                    const p = priceOf(g);
                    const q = Number((qty[g.id] ?? '').replace(',', '.'));
                    return (
                      <tr key={g.id}>
                        <td className={td}>
                          <div className="font-medium">{locale === 'en' && g.name_en ? g.name_en : g.name_bg}</div>
                          {g.sku ? <div className="text-[12px] text-neutral-500">{g.sku}</div> : null}
                        </td>
                        <td className={tdNum}>
                          {f.money(p.cents)} / {f.unit(g.unit)}
                          {p.locked ? <div className="text-[11px] text-gold">{t('lockedPrice')}</div> : null}
                        </td>
                        <td className={tdNum}>{f.pct(g.vat_bp)}</td>
                        <td className={`${td} w-32`}>
                          <In inputMode="decimal" value={qty[g.id] ?? ''} onChange={(e) => setQty({ ...qty, [g.id]: e.target.value })} aria-label={t('quantity')} placeholder="0" />
                        </td>
                        <td className={tdNum}>{q > 0 ? f.money(Math.round(q * p.cents)) : ''}</td>
                      </tr>
                    );
                  })}
                </Table>
                <p className="mt-2 text-[12px] text-neutral-500">{t('priceLockHint')}</p>
              </>
            ) : (
              <Empty>{t('noGoods')}</Empty>
            )}
            {action.field('items') ? <p className="mt-2 text-[13px] text-red-600">{action.field('items')}</p> : null}
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
