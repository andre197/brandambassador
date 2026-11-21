'use client';

import { ORDER_STATUSES } from '@ba/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Btn, In, Loaded, PageHeader, Sel, useData } from '@/components/kit';
import { OrderTable } from '@/components/orders/order-table';
import { useMe } from '@/components/session';
import type { Merchant, OrderListRow, Producer } from '@/lib/types';

function OrdersList() {
  const t = useTranslations('orders');
  const ts = useTranslations('orderStatus');
  const tc = useTranslations('common');
  const me = useMe();
  const sp = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [producer, setProducer] = useState(sp.get('producer_id') ?? '');
  const [merchant, setMerchant] = useState(sp.get('merchant_id') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (producer) params.set('producer_id', producer);
  if (merchant) params.set('merchant_id', merchant);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const state = useData<OrderListRow[]>(`/orders?${params.toString()}`);
  const producers = useData<Producer[]>(me.role === 'producer' ? null : '/producers');
  const merchants = useData<Merchant[]>(me.role === 'merchant' ? null : '/merchants');

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Link href="/orders/new">
            <Btn tone="primary">+ {t('new')}</Btn>
          </Link>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <In className="lg:col-span-2" placeholder={t('searchHint')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Sel value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('allStatuses')}</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ts(s)}
            </option>
          ))}
        </Sel>
        {me.role !== 'producer' ? (
          <Sel value={producer} onChange={(e) => setProducer(e.target.value)}>
            <option value="">{t('allProducers')}</option>
            {(producers.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Sel>
        ) : null}
        {me.role !== 'merchant' ? (
          <Sel value={merchant} onChange={(e) => setMerchant(e.target.value)}>
            <option value="">{t('allMerchants')}</option>
            {(merchants.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Sel>
        ) : null}
        <div className="flex gap-2">
          <In type="date" aria-label={tc('from')} value={from} onChange={(e) => setFrom(e.target.value)} />
          <In type="date" aria-label={tc('to')} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <Loaded state={state}>{(rows) => <OrderTable rows={rows} />}</Loaded>
    </>
  );
}

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersList />
    </Suspense>
  );
}
