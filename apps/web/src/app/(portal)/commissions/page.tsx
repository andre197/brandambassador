'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CommissionBadge } from '@/components/badges';
import { Btn, Card, downloadCsv, Empty, In, Loaded, PageHeader, Sel, Stat, Table, td, tdNum, useData, useFmt } from '@/components/kit';
import { useMe } from '@/components/session';
import type { Calc, Producer } from '@/lib/types';

interface Totals {
  orders: number;
  netCents: number;
  commissionCents: number;
  accruedCents: number;
  receivedCents: number;
  outstandingCents: number;
  overdueCents: number;
}

interface Report {
  rows: { id: string; number: number; order_date: string; status: string; producer_name: string; merchant_name: string; invoice_number: string | null; calc: Calc }[];
  totals: Totals;
  producers: (Totals & { producer_id: string; producer_name: string })[];
  payments: { id: string; amount_cents: number; paid_on: string; note: string | null; order_id: string; number: number; producer_name: string; merchant_name: string }[];
}

export default function CommissionsPage() {
  const t = useTranslations('commissions');
  const tc = useTranslations('common');
  const tcs = useTranslations('commissionStatus');
  const f = useFmt();
  const me = useMe();
  const admin = me.role === 'admin';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [producer, setProducer] = useState('');
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  if (producer) q.set('producer_id', producer);
  const state = useData<Report>(`/reports/commissions?${q.toString()}`);
  const producers = useData<Producer[]>(admin ? '/producers' : null);

  const exportCsv = (r: Report) =>
    downloadCsv(`commissions-${new Date().toISOString().slice(0, 10)}.csv`, [
      [t('order'), t('date'), t('producer'), t('merchant'), t('invoice'), t('base'), t('rate'), t('commission'), t('accrued'), t('received'), t('outstanding'), t('nextDue'), t('status')],
      ...r.rows.map((x) => [
        x.number,
        x.order_date,
        x.producer_name,
        x.merchant_name,
        x.invoice_number,
        (x.calc.baseNetCents / 100).toFixed(2),
        ((x.calc.commissionBp ?? 0) / 100).toFixed(2),
        ((x.calc.commissionCents ?? 0) / 100).toFixed(2),
        ((x.calc.commissionAccruedCents ?? 0) / 100).toFixed(2),
        ((x.calc.commissionReceivedCents ?? 0) / 100).toFixed(2),
        ((x.calc.commissionOutstandingCents ?? 0) / 100).toFixed(2),
        x.calc.commissionNextDueOn ?? '',
        x.calc.commissionStatus ? tcs(x.calc.commissionStatus) : '',
      ]),
    ]);

  return (
    <>
      <PageHeader title={admin ? t('title') : t('producerTitle')}>{admin ? t('intro') : t('producerIntro')}</PageHeader>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <In type="date" label={tc('from')} value={from} onChange={(e) => setFrom(e.target.value)} />
        <In type="date" label={tc('to')} value={to} onChange={(e) => setTo(e.target.value)} />
        {admin ? (
          <Sel label={t('producer')} value={producer} onChange={(e) => setProducer(e.target.value)}>
            <option value="">{t('allProducers')}</option>
            {(producers.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Sel>
        ) : null}
        {state.data ? <Btn onClick={() => exportCsv(state.data!)}>{t('export')}</Btn> : null}
      </div>
      <Loaded state={state}>
        {(r) => (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={t('commission')} value={f.money(r.totals.commissionCents)} sub={t('onSales', { amount: f.money(r.totals.netCents) })} />
              <Stat label={t('received')} value={f.money(r.totals.receivedCents)} tone="green" />
              <Stat label={t('outstanding')} value={f.money(r.totals.outstandingCents)} tone="amber" sub={t('notYetDue', { amount: f.money(r.totals.commissionCents - r.totals.accruedCents) })} />
              <Stat label={t('overdue')} value={f.money(r.totals.overdueCents)} tone={r.totals.overdueCents ? 'red' : undefined} />
            </div>

            {admin && r.producers.length > 1 ? (
              <Card title={t('byProducer')}>
                <Table head={[t('producer'), t('orders'), t('base'), t('commission'), t('received'), t('outstanding'), t('overdue')]}>
                  {r.producers.map((p) => (
                    <tr key={p.producer_id}>
                      <td className={td}>
                        <Link href={`/producers/${p.producer_id}`} className="font-medium text-ink hover:underline">
                          {p.producer_name}
                        </Link>
                      </td>
                      <td className={tdNum}>{p.orders}</td>
                      <td className={tdNum}>{f.money(p.netCents)}</td>
                      <td className={tdNum}>{f.money(p.commissionCents)}</td>
                      <td className={tdNum}>{f.money(p.receivedCents)}</td>
                      <td className={tdNum}>{f.money(p.outstandingCents)}</td>
                      <td className={`${tdNum} ${p.overdueCents ? 'text-red-700' : ''}`}>{f.money(p.overdueCents)}</td>
                    </tr>
                  ))}
                </Table>
              </Card>
            ) : null}

            <Card title={t('byOrder')}>
              {r.rows.length ? (
                <Table head={[t('order'), t('date'), ...(admin ? [t('producer')] : []), t('merchant'), t('base'), t('rate'), t('commission'), t('accrued'), t('received'), t('outstanding'), t('nextDue'), t('status')]}>
                  {r.rows.map((x) => (
                    <tr key={x.id}>
                      <td className={td}>
                        <Link href={`/orders/${x.id}`} className="font-medium text-ink hover:underline">
                          №{x.number}
                        </Link>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>{f.date(x.order_date)}</td>
                      {admin ? <td className={td}>{x.producer_name}</td> : null}
                      <td className={td}>{x.merchant_name}</td>
                      <td className={tdNum}>{f.money(x.calc.baseNetCents)}</td>
                      <td className={tdNum}>{f.pct(x.calc.commissionBp)}</td>
                      <td className={tdNum}>{f.money(x.calc.commissionCents)}</td>
                      <td className={tdNum}>{f.money(x.calc.commissionAccruedCents)}</td>
                      <td className={`${tdNum} text-green-700`}>{f.money(x.calc.commissionReceivedCents)}</td>
                      <td className={tdNum}>{f.money(x.calc.commissionOutstandingCents)}</td>
                      <td className={`${td} whitespace-nowrap`}>{f.date(x.calc.commissionNextDueOn)}</td>
                      <td className={td}>
                        <CommissionBadge status={x.calc.commissionStatus} />
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty />
              )}
            </Card>

            <Card title={admin ? t('receivedList') : t('paidList')}>
              {r.payments.length ? (
                <Table head={[t('date'), t('order'), ...(admin ? [t('producer')] : []), t('merchant'), t('amount'), t('note')]}>
                  {r.payments.map((p) => (
                    <tr key={p.id}>
                      <td className={`${td} whitespace-nowrap`}>{f.date(p.paid_on)}</td>
                      <td className={td}>
                        <Link href={`/orders/${p.order_id}`} className="text-ink hover:underline">
                          №{p.number}
                        </Link>
                      </td>
                      {admin ? <td className={td}>{p.producer_name}</td> : null}
                      <td className={td}>{p.merchant_name}</td>
                      <td className={`${tdNum} font-medium`}>{f.money(p.amount_cents)}</td>
                      <td className={`${td} text-[13px]`}>{p.note ?? ''}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty />
              )}
            </Card>
            <p className="text-[12px] text-neutral-500">{t('rules')}</p>
          </div>
        )}
      </Loaded>
    </>
  );
}
