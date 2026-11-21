'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Btn, Card, Empty, Loaded, PageHeader, Stat, Table, td, tdNum, useData, useFmt } from '@/components/kit';
import { OrderTable } from '@/components/orders/order-table';
import { useMe } from '@/components/session';
import type { OrderListRow } from '@/lib/types';

interface Totals {
  orders: number;
  netCents: number;
  commissionCents: number;
  accruedCents: number;
  receivedCents: number;
  outstandingCents: number;
  overdueCents: number;
}

interface StaffDashboard {
  unread: number;
  totals: Totals;
  year: Totals;
  receivedMonthCents: number;
  receivedYearCents: number;
  newOrders: number;
  pendingRequests: number;
  recent: OrderListRow[];
  overdue: OrderListRow[];
  due: OrderListRow[];
  reminders?: { id: string; due_on: string; merchant_name: string; producer_name: string | null }[];
  contracts?: { id: string; name: string; end: string; notice: string }[];
}

interface MerchantDashboard {
  unread: number;
  reminders: { id: string; due_on: string; message: string | null; producer_name: string | null; producer_id: string | null }[];
  pendingRequests: number;
  openOrders: number;
  recent: OrderListRow[];
}

function DueTable({ rows }: { rows: OrderListRow[] }) {
  const t = useTranslations('orders');
  const me = useMe();
  const f = useFmt();
  if (!rows.length) return <Empty />;
  return (
    <Table head={[t('number'), ...(me.role === 'admin' ? [t('producer')] : []), t('merchant'), t('outstanding'), t('nextDue')]}>
      {rows.map((o) => (
        <tr key={o.id}>
          <td className={td}>
            <Link href={`/orders/${o.id}`} className="font-medium text-ink hover:underline">
              №{o.number}
            </Link>
          </td>
          {me.role === 'admin' ? <td className={td}>{o.producer_name}</td> : null}
          <td className={td}>{o.merchant_name}</td>
          <td className={tdNum}>{f.money(o.calc.commissionOutstandingCents)}</td>
          <td className={`${td} whitespace-nowrap`}>{f.date(o.calc.commissionNextDueOn)}</td>
        </tr>
      ))}
    </Table>
  );
}

function Staff({ d }: { d: StaffDashboard }) {
  const t = useTranslations('dashboard');
  const f = useFmt();
  const me = useMe();
  const admin = me.role === 'admin';
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {admin ? (
          <>
            <Stat label={t('receivedMonth')} value={f.money(d.receivedMonthCents)} tone="green" />
            <Stat label={t('receivedYear')} value={f.money(d.receivedYearCents)} sub={t('ofCommission', { amount: f.money(d.year.commissionCents) })} />
          </>
        ) : (
          <>
            <Stat label={t('salesYear')} value={f.money(d.year.netCents)} sub={t('ordersCount', { count: d.year.orders })} />
            <Stat label={t('paidYear')} value={f.money(d.receivedYearCents)} />
          </>
        )}
        <Stat label={admin ? t('outstanding') : t('owed')} value={f.money(d.totals.outstandingCents)} tone="amber" sub={t('notYetDue', { amount: f.money(d.totals.commissionCents - d.totals.accruedCents) })} />
        <Stat label={t('overdue')} value={f.money(d.totals.overdueCents)} tone={d.totals.overdueCents ? 'red' : undefined} />
      </div>
      <div className="flex flex-wrap gap-3 text-[14px]">
        <Link href="/orders?status=new" className="rounded-md border border-neutral-200 bg-white px-3 py-2 shadow-sm hover:bg-neutral-50">
          {t('newOrders', { count: d.newOrders })}
        </Link>
        <Link href="/requests" className="rounded-md border border-neutral-200 bg-white px-3 py-2 shadow-sm hover:bg-neutral-50">
          {t('pendingRequests', { count: d.pendingRequests })}
        </Link>
        <Link href="/notifications" className="rounded-md border border-neutral-200 bg-white px-3 py-2 shadow-sm hover:bg-neutral-50">
          {t('unread', { count: d.unread })}
        </Link>
      </div>

      {admin && d.contracts?.length ? (
        <Card title={t('contracts')}>
          <ul className="space-y-1 text-[14px]">
            {d.contracts.map((c) => (
              <li key={c.id}>
                <Link href={`/producers/${c.id}`} className="font-medium text-ink hover:underline">
                  {c.name}
                </Link>{' '}
                - {t('contractLine', { end: f.date(c.end), notice: f.date(c.notice) })}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('overdueList')}>
          <DueTable rows={d.overdue} />
        </Card>
        <Card title={t('dueList')}>
          <DueTable rows={d.due} />
        </Card>
      </div>

      {admin && d.reminders?.length ? (
        <Card title={t('reminders')} actions={<Link href="/reminders" className="text-[13px] text-neutral-600 hover:underline">{t('all')}</Link>}>
          <ul className="space-y-1 text-[14px]">
            {d.reminders.map((r) => (
              <li key={r.id}>
                <strong>{f.date(r.due_on)}</strong> · {r.merchant_name}
                {r.producer_name ? ` → ${r.producer_name}` : ''}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title={t('recent')} actions={<Link href="/orders" className="text-[13px] text-neutral-600 hover:underline">{t('all')}</Link>}>
        <OrderTable rows={d.recent} compact />
      </Card>
    </div>
  );
}

function MerchantHome({ d }: { d: MerchantDashboard }) {
  const t = useTranslations('dashboard');
  const f = useFmt();
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={t('openOrders')} value={d.openOrders} />
        <Stat label={t('openReminders')} value={d.reminders.length} tone={d.reminders.length ? 'amber' : undefined} />
        <Stat label={t('pendingRequestsLabel')} value={d.pendingRequests} />
      </div>
      <Card title={t('ordersToPlace')}>
        {d.reminders.length ? (
          <ul className="divide-y divide-neutral-100 text-[14px]">
            {d.reminders.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{f.date(r.due_on)}</strong>
                  {r.producer_name ? ` · ${r.producer_name}` : ''}
                  {r.message ? <span className="text-neutral-600"> · {r.message}</span> : null}
                </span>
                <Link href={r.producer_id ? `/orders/new?producer_id=${r.producer_id}` : '/orders/new'}>
                  <Btn size="sm" tone="primary">
                    {t('placeOrder')}
                  </Btn>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t('noReminders')}</Empty>
        )}
      </Card>
      <Card title={t('recent')} actions={<Link href="/orders" className="text-[13px] text-neutral-600 hover:underline">{t('all')}</Link>}>
        <OrderTable rows={d.recent} compact />
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const me = useMe();
  const state = useData<StaffDashboard | MerchantDashboard>('/dashboard');
  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Link href="/orders/new">
            <Btn tone="primary">+ {t('newOrder')}</Btn>
          </Link>
        }
      >
        {t(`intro.${me.role}`)}
      </PageHeader>
      <Loaded state={state}>{(d) => (me.role === 'merchant' ? <MerchantHome d={d as MerchantDashboard} /> : <Staff d={d as StaffDashboard} />)}</Loaded>
    </>
  );
}
