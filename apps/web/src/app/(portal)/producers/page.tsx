'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ActiveBadge } from '@/components/badges';
import { Badge, Btn, Card, Empty, In, Loaded, PageHeader, Pager, Table, td, tdNum, useData, useFmt, useListFilter } from '@/components/kit';
import { useMe } from '@/components/session';
import type { Producer } from '@/lib/types';

function AdminList({ rows }: { rows: Producer[] }) {
  const t = useTranslations('producers');
  const tc = useTranslations('common');
  const f = useFmt();
  const list = useListFilter(rows, (p) => `${p.name} ${p.eik} ${p.email}`);
  const soon = (iso?: string) => (iso ? new Date(iso).getTime() - Date.now() < 45 * 86_400_000 : false);
  return (
    <>
      <In className="mb-4 max-w-sm" placeholder={tc('search')} value={list.q} onChange={(e) => list.setQ(e.target.value)} />
      {list.rows.length ? (
        <>
          <Table head={[t('name'), t('commission'), t('goods'), t('merchants'), t('sales'), t('commissionTotal'), t('received'), t('contract'), '']}>
            {list.rows.map((p) => (
              <tr key={p.id}>
                <td className={td}>
                  <Link href={`/producers/${p.id}`} className="font-medium text-ink hover:underline">
                    {p.name}
                  </Link>
                  <div className="text-[12px] text-neutral-500">ЕИК {p.eik}</div>
                </td>
                <td className={tdNum}>{f.pct(p.commission_bp)}</td>
                <td className={tdNum}>{p.goods_count}</td>
                <td className={tdNum}>{p.merchants_count}</td>
                <td className={tdNum}>{f.money(p.stats?.net_cents)}</td>
                <td className={tdNum}>{f.money(p.stats?.commission_cents)}</td>
                <td className={tdNum}>{f.money(p.stats?.received_cents)}</td>
                <td className={`${td} whitespace-nowrap text-[13px]`}>
                  {p.contract ? (
                    <>
                      {f.date(p.contract.end)}
                      {soon(p.contract.notice) ? (
                        <div>
                          <Badge tone="amber">{t('noticeBy', { date: f.date(p.contract.notice) })}</Badge>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    '-'
                  )}
                </td>
                <td className={td}>
                  <ActiveBadge active={p.active} />
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

function MerchantList({ rows }: { rows: Producer[] }) {
  const t = useTranslations('producers');
  const tc = useTranslations('common');
  const f = useFmt();
  const list = useListFilter(rows, (p) => `${p.name} ${p.address}`);
  return (
    <>
      <In className="mb-4 max-w-sm" placeholder={tc('search')} value={list.q} onChange={(e) => list.setQ(e.target.value)} />
      {list.rows.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {list.rows.map((p) => (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/producers/${p.id}`} className="text-[16px] font-semibold text-ink hover:underline">
                    {p.name}
                  </Link>
                  <p className="text-[13px] text-neutral-500">{p.address}</p>
                  <p className="mt-1 text-[13px] text-neutral-700">
                    {p.phone} · {p.email}
                  </p>
                </div>
                <Link href={`/orders/new?producer_id=${p.id}`}>
                  <Btn size="sm" tone="primary">
                    {t('order')}
                  </Btn>
                </Link>
              </div>
              <p className="mt-3 text-[13px] text-neutral-600">
                {t('goodsCount', { count: p.goods_count ?? 0 })} · {t('myOrders', { count: p.my_orders ?? 0 })}
                {p.my_last_order_on ? ` · ${t('lastOrder', { date: f.date(p.my_last_order_on) })}` : ''}
              </p>
            </Card>
          ))}
        </div>
      ) : (
        <Empty />
      )}
    </>
  );
}

export default function ProducersPage() {
  const t = useTranslations('producers');
  const me = useMe();
  const state = useData<Producer[]>('/producers');
  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          me.role === 'admin' ? (
            <Link href="/producers/new">
              <Btn tone="primary">+ {t('new')}</Btn>
            </Link>
          ) : null
        }
      >
        {me.role === 'merchant' ? t('merchantIntro') : null}
      </PageHeader>
      <Loaded state={state}>{(rows) => (me.role === 'admin' ? <AdminList rows={rows} /> : <MerchantList rows={rows} />)}</Loaded>
    </>
  );
}
