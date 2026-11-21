'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ActiveBadge } from '@/components/badges';
import { AgreedPrices } from '@/components/goods/agreed-prices';
import { GoodsManager } from '@/components/goods/goods-manager';
import { Btn, Card, ConfirmBtn, Empty, ErrorNote, Facts, In, Loaded, Modal, PageHeader, Table, Tabs, td, tdNum, Txt, useAction, useData, useFmt } from '@/components/kit';
import { OrderTable } from '@/components/orders/order-table';
import { PairsCard } from '@/components/parties/pairs-card';
import { ProducerForm } from '@/components/parties/party-form';
import { TradeReport } from '@/components/parties/trade-report';
import { UsersCard } from '@/components/parties/users-card';
import { useMe } from '@/components/session';
import { api } from '@/lib/api-client';
import type { Good, OrderListRow, Producer } from '@/lib/types';

type Tab = 'details' | 'buyers' | 'goods' | 'prices' | 'trade' | 'orders' | 'users';

function AdminProducer({ p, reload }: { p: Producer; reload(): void }) {
  const t = useTranslations('producers');
  const tc = useTranslations('common');
  const f = useFmt();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('details');
  const remove = useAction();
  const orders = useData<OrderListRow[]>(tab === 'orders' ? `/orders?producer_id=${p.id}` : null);
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {p.name} <ActiveBadge active={p.active} />
          </span>
        }
        actions={
          <>
            <Link href={`/orders/new?producer_id=${p.id}`}>
              <Btn tone="primary">+ {t('newOrder')}</Btn>
            </Link>
            <ConfirmBtn
              size="md"
              busy={remove.busy}
              onConfirm={async () => {
                if (await remove.run(() => api(`/producers/${p.id}`, { method: 'DELETE' }))) router.replace('/producers');
              }}
            >
              {tc('delete')}
            </ConfirmBtn>
          </>
        }
      >
        ЕИК {p.eik} · {t('commission')} {f.pct(p.commission_bp)}
        {p.contract ? ` · ${t('contractLine', { end: f.date(p.contract.end), notice: f.date(p.contract.notice) })}` : ''}
      </PageHeader>
      {remove.error ? (
        <div className="mb-4">
          <ErrorNote>{remove.error}</ErrorNote>
        </div>
      ) : null}
      <Tabs
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        options={(['details', 'buyers', 'goods', 'prices', 'trade', 'orders', 'users'] as Tab[]).map((v) => ({ value: v, label: t(`tabs.${v}`) }))}
      />
      {tab === 'details' ? <ProducerForm initial={p} onSaved={reload} /> : null}
      {tab === 'buyers' ? <PairsCard producerId={p.id} /> : null}
      {tab === 'goods' ? <GoodsManager producerId={p.id} /> : null}
      {tab === 'prices' ? <AgreedPrices producerId={p.id} /> : null}
      {tab === 'trade' ? <TradeReport producerId={p.id} /> : null}
      {tab === 'orders' ? <Loaded state={orders}>{(rows) => <OrderTable rows={rows} />}</Loaded> : null}
      {tab === 'users' ? <UsersCard producerId={p.id} /> : null}
    </>
  );
}

function Ask({ good }: { good: Good }) {
  const t = useTranslations('requests');
  const action = useAction();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => api('/requests', { method: 'POST', body: { good_id: good.id, proposed_price: price || null, description } }))) {
      setOpen(false);
      setSent(true);
    }
  };
  return (
    <>
      <Btn size="sm" tone="ghost" onClick={() => setOpen(true)}>
        {sent ? t('sent') : t('askShort')}
      </Btn>
      <Modal title={`${t('ask')}: ${good.name_bg}`} open={open} onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-4">
          <In label={t('proposed')} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} error={action.field('proposed_price')} hint={t('proposedHint')} />
          <Txt label={t('description')} value={description} onChange={(e) => setDescription(e.target.value)} />
          <ErrorNote>{action.error}</ErrorNote>
          <Btn tone="primary" type="submit" busy={action.busy}>
            {t('send')}
          </Btn>
        </form>
      </Modal>
    </>
  );
}

function MerchantView({ p }: { p: Producer }) {
  const t = useTranslations('producers');
  const tg = useTranslations('goods');
  const tdm = useTranslations('deliveryMethods');
  const tim = useTranslations('invoiceMethods');
  const locale = useLocale();
  const f = useFmt();
  const goods = useData<Good[]>(`/goods?producer_id=${p.id}`);
  const orders = useData<OrderListRow[]>(`/orders?producer_id=${p.id}`);
  return (
    <>
      <PageHeader
        title={p.name}
        actions={
          <Link href={`/orders/new?producer_id=${p.id}`}>
            <Btn tone="primary">+ {t('order')}</Btn>
          </Link>
        }
      >
        ЕИК {p.eik}
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card title={tg('title')}>
            <Loaded state={goods}>
              {(rows) =>
                rows.length ? (
                  <Table head={[tg('name'), tg('myPrice'), tg('vat'), '']}>
                    {rows.map((g) => (
                      <tr key={g.id}>
                        <td className={td}>
                          <div className="font-medium">{locale === 'en' && g.name_en ? g.name_en : g.name_bg}</div>
                          {g.description ? <div className="text-[12px] text-neutral-500">{g.description}</div> : null}
                        </td>
                        <td className={tdNum}>
                          {f.money(g.my_price_cents)} / {f.unit(g.unit)}
                          {g.price_locked ? <div className="text-[11px] text-gold">{tg('locked')}</div> : null}
                        </td>
                        <td className={tdNum}>{f.pct(g.vat_bp)}</td>
                        <td className={`${td} text-right`}>
                          <Ask good={g} />
                        </td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <Empty />
                )
              }
            </Loaded>
          </Card>
          <Card title={t('myOrdersTitle')}>
            <Loaded state={orders}>{(rows) => <OrderTable rows={rows} compact />}</Loaded>
          </Card>
        </div>
        <Card title={t('contact')}>
          <Facts
            items={[
              [t('phone'), p.phone],
              [t('email'), p.email],
              [t('address'), p.address],
              [t('contactPerson'), p.contact_person],
              [t('delivery'), `${tdm(p.delivery_method as never)}${p.delivery_note ? ` · ${p.delivery_note}` : ''}`],
              [t('invoices'), tim(p.invoice_method as never)],
            ]}
          />
        </Card>
      </div>
    </>
  );
}

export default function ProducerPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const state = useData<Producer>(`/producers/${id}`);
  return <Loaded state={state}>{(p) => (me.role === 'admin' ? <AdminProducer p={p} reload={() => void state.reload()} /> : <MerchantView p={p} />)}</Loaded>;
}
