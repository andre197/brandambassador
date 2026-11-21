'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ActiveBadge } from '@/components/badges';
import { Badge, Btn, Empty, In, Loaded, PageHeader, Pager, Table, td, tdNum, useData, useFmt, useListFilter } from '@/components/kit';
import { TradeReport } from '@/components/parties/trade-report';
import { useMe } from '@/components/session';
import type { Merchant } from '@/lib/types';

function AdminList({ rows }: { rows: Merchant[] }) {
  const t = useTranslations('merchants');
  const tc = useTranslations('common');
  const ti = useTranslations('invoiceMethods');
  const f = useFmt();
  const list = useListFilter(rows, (m) => `${m.name} ${m.eik} ${m.email} ${m.address}`);
  return (
    <>
      <In className="mb-4 max-w-sm" placeholder={tc('search')} value={list.q} onChange={(e) => list.setQ(e.target.value)} />
      {list.rows.length ? (
        <>
          <Table head={[t('name'), t('address'), t('invoices'), t('producers'), t('sales'), t('lastOrder'), '']}>
            {list.rows.map((m) => (
              <tr key={m.id}>
                <td className={td}>
                  <Link href={`/merchants/${m.id}`} className="font-medium text-ink hover:underline">
                    {m.name}
                  </Link>
                  <div className="text-[12px] text-neutral-500">ЕИК {m.eik}</div>
                </td>
                <td className={`${td} text-[13px]`}>{m.address}</td>
                <td className={`${td} text-[13px]`}>{ti(m.invoice_method as never)}</td>
                <td className={tdNum}>{m.producers_count}</td>
                <td className={tdNum}>{f.money(m.stats?.net_cents)}</td>
                <td className={`${td} whitespace-nowrap`}>{f.date(m.stats?.last_order_on)}</td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    <ActiveBadge active={m.active} />
                    {m.open_reminders ? <Badge tone="amber">{t('reminders', { count: m.open_reminders })}</Badge> : null}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
          <Pager page={list.page} perPage={list.perPage} total={list.total} onPage={list.setPage} />
        </>
      ) : (
        <Empty />
      )}
    </>
  );
}

export default function MerchantsPage() {
  const t = useTranslations('merchants');
  const me = useMe();
  const state = useData<Merchant[]>(me.role === 'admin' ? '/merchants' : null);
  if (me.role === 'producer') {
    return (
      <>
        <PageHeader title={t('tradeTitle')}>{t('tradeIntro')}</PageHeader>
        <TradeReport producerId={me.producer_id!} />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Link href="/merchants/new">
            <Btn tone="primary">+ {t('new')}</Btn>
          </Link>
        }
      />
      <Loaded state={state}>{(rows) => <AdminList rows={rows} />}</Loaded>
    </>
  );
}
