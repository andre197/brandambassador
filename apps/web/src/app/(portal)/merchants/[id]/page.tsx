'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActiveBadge } from '@/components/badges';
import { AgreedPrices } from '@/components/goods/agreed-prices';
import { Badge, Btn, Card, ConfirmBtn, Empty, ErrorNote, Facts, Loaded, PageHeader, Table, Tabs, td, tdNum, useAction, useData, useFmt } from '@/components/kit';
import { OrderTable } from '@/components/orders/order-table';
import { MerchantForm } from '@/components/parties/party-form';
import { ShopsCard } from '@/components/parties/shops-card';
import { UsersCard } from '@/components/parties/users-card';
import { RemindersPanel } from '@/components/reminders/reminders-panel';
import { useMe } from '@/components/session';
import { api } from '@/lib/api-client';
import type { Merchant, OrderListRow, Pair } from '@/lib/types';

type Tab = 'details' | 'shops' | 'producers' | 'prices' | 'reminders' | 'orders' | 'users';

function ProducersOfMerchant({ merchantId }: { merchantId: string }) {
  const t = useTranslations('pairs');
  const tp = useTranslations('pairStatus');
  const f = useFmt();
  const state = useData<Pair[]>(`/merchants/${merchantId}/pairs`);
  return (
    <Card title={t('producersTitle')}>
      <Loaded state={state}>
        {(rows) =>
          rows.length ? (
            <Table head={[t('producer'), t('status'), t('orders'), t('total'), t('lastOrder'), t('active')]}>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className={td}>
                    <Link href={`/producers/${p.producer_id}`} className="font-medium text-ink hover:underline">
                      {p.producer_name}
                    </Link>
                  </td>
                  <td className={td}>
                    <Badge tone={p.status === 'attracted' ? 'blue' : 'gray'}>{tp(p.status)}</Badge>
                  </td>
                  <td className={tdNum}>{p.orders}</td>
                  <td className={tdNum}>{f.money(p.total_net_cents)}</td>
                  <td className={`${td} whitespace-nowrap`}>{f.date(p.last_order_on)}</td>
                  <td className={td}>{p.active_buyer ? <Badge tone="green">{t('activeYes')}</Badge> : <Badge>{t('activeNo')}</Badge>}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty />
          )
        }
      </Loaded>
    </Card>
  );
}

function AdminMerchant({ m, reload }: { m: Merchant; reload(): void }) {
  const t = useTranslations('merchants');
  const tc = useTranslations('common');
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('details');
  const remove = useAction();
  const orders = useData<OrderListRow[]>(tab === 'orders' ? `/orders?merchant_id=${m.id}` : null);
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {m.name} <ActiveBadge active={m.active} />
          </span>
        }
        actions={
          <>
            <Link href={`/orders/new?merchant_id=${m.id}`}>
              <Btn tone="primary">+ {t('newOrder')}</Btn>
            </Link>
            <ConfirmBtn
              size="md"
              busy={remove.busy}
              onConfirm={async () => {
                if (await remove.run(() => api(`/merchants/${m.id}`, { method: 'DELETE' }))) router.replace('/merchants');
              }}
            >
              {tc('delete')}
            </ConfirmBtn>
          </>
        }
      >
        ЕИК {m.eik} · {m.address}
      </PageHeader>
      {remove.error ? (
        <div className="mb-4">
          <ErrorNote>{remove.error}</ErrorNote>
        </div>
      ) : null}
      <Tabs value={tab} onChange={(v) => setTab(v as Tab)} options={(['details', 'shops', 'producers', 'prices', 'reminders', 'orders', 'users'] as Tab[]).map((v) => ({ value: v, label: t(`tabs.${v}`) }))} />
      {tab === 'details' ? <MerchantForm initial={m} onSaved={reload} /> : null}
      {tab === 'shops' ? <ShopsCard merchantId={m.id} /> : null}
      {tab === 'producers' ? <ProducersOfMerchant merchantId={m.id} /> : null}
      {tab === 'prices' ? <AgreedPrices merchantId={m.id} /> : null}
      {tab === 'reminders' ? <RemindersPanel merchantId={m.id} /> : null}
      {tab === 'orders' ? <Loaded state={orders}>{(rows) => <OrderTable rows={rows} />}</Loaded> : null}
      {tab === 'users' ? <UsersCard merchantId={m.id} /> : null}
    </>
  );
}

/** What a producer sees of a merchant it trades with. */
function ProducerView({ m }: { m: Merchant }) {
  const t = useTranslations('merchants');
  const ti = useTranslations('invoiceMethods');
  const me = useMe();
  const orders = useData<OrderListRow[]>(`/orders?merchant_id=${m.id}`);
  return (
    <>
      <PageHeader
        title={m.name}
        actions={
          <Link href={`/orders/new?merchant_id=${m.id}`}>
            <Btn tone="primary">+ {t('recordOrder')}</Btn>
          </Link>
        }
      >
        ЕИК {m.eik}
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <ShopsCard merchantId={m.id} />
          <AgreedPrices producerId={me.producer_id!} merchantId={m.id} />
          <Card title={t('ordersTitle')}>
            <Loaded state={orders}>{(rows) => <OrderTable rows={rows} compact />}</Loaded>
          </Card>
        </div>
        <Card title={t('contact')}>
          <Facts
            items={[
              [t('phone'), m.phone],
              [t('email'), m.email],
              [t('address'), m.address],
              [t('contactPerson'), m.contact_person],
              [t('invoices'), `${ti(m.invoice_method as never)}${m.invoice_email ? ` · ${m.invoice_email}` : ''}`],
              [t('invoiceNote'), m.invoice_note],
              [t('receiving'), m.delivery_note],
            ]}
          />
        </Card>
      </div>
    </>
  );
}

export default function MerchantPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const state = useData<Merchant>(`/merchants/${id}`);
  return <Loaded state={state}>{(m) => (me.role === 'admin' ? <AdminMerchant m={m} reload={() => void state.reload()} /> : <ProducerView m={m} />)}</Loaded>;
}
