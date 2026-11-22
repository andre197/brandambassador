'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, Card, Empty, Loaded, Stat, Table, td, tdNum, useData, useFmt } from '../kit';
import { useMe } from '../session';

interface Trade {
  merchants: {
    merchant_id: string;
    merchant_name: string;
    merchant_address: string;
    net_cents: number;
    last_order_on: string;
    pair_status: string;
    active_buyer: boolean;
    termination_penalty_cents: number;
    lines: { good_id: string | null; name_bg: string; name_en: string | null; unit: string; quantity_milli: number; net_cents: number; gross_cents: number; orders: number; last_order_on: string; last_price_cents: number; agreed_price_cents: number | null; last_price_gross_cents: number; agreed_price_gross_cents: number | null }[];
  }[];
  totals: { netCents: number; activeBuyers: number; last12MonthsNetCents: number; terminationPenaltyCents: number; concealmentPenaltyCents: number };
}

/** Where a producer's goods are traded, at what price and how much. */
export function TradeReport({ producerId }: { producerId: string }) {
  const t = useTranslations('trade');
  const tp = useTranslations('pairStatus');
  const locale = useLocale();
  const f = useFmt();
  const me = useMe();
  const state = useData<Trade>(`/producers/${producerId}/trade`);
  return (
    <Loaded state={state}>
      {(d) => (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label={t('merchants')} value={d.merchants.length} sub={t('activeBuyers', { count: d.totals.activeBuyers })} />
            <Stat label={t('total')} value={f.money(d.totals.netCents)} />
            <Stat label={t('last12')} value={f.money(d.totals.last12MonthsNetCents)} />
          </div>
          {me.role === 'admin' ? (
            <Card title={t('contractFigures')}>
              <p className="text-[14px]">{t('termination', { amount: f.money(d.totals.terminationPenaltyCents) })}</p>
              <p className="text-[14px]">{t('concealment', { amount: f.money(d.totals.concealmentPenaltyCents) })}</p>
              <p className="mt-2 text-[12px] text-neutral-500">{t('contractNote')}</p>
            </Card>
          ) : null}
          {d.merchants.length ? (
            // One table for all goods sold, grouped by merchant: a heading row per merchant, then its goods.
            <Card title={t('goodsSold')}>
              <Table head={[t('good'), t('price'), t('priceGross'), t('quantity'), t('net'), t('gross'), t('orders'), t('lastOrderCol')]}>
                {d.merchants.map((m) => {
                  const gross = m.lines.reduce((sum, l) => sum + Number(l.gross_cents), 0);
                  return (
                    <Fragment key={m.merchant_id}>
                      <tr className="border-t-2 border-neutral-200 bg-neutral-50">
                        <td className={td} colSpan={4}>
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/merchants/${m.merchant_id}`} className="font-semibold text-ink hover:underline">
                              {m.merchant_name}
                            </Link>
                            {m.pair_status !== 'attracted' ? <Badge>{tp(m.pair_status as never)}</Badge> : null}
                            {m.active_buyer ? <Badge tone="green">{t('active')}</Badge> : <Badge>{t('inactive')}</Badge>}
                          </div>
                          <div className="text-[12px] text-neutral-500">{m.merchant_address}</div>
                        </td>
                        <td className={`${tdNum} font-semibold`}>{f.money(m.net_cents)}</td>
                        <td className={`${tdNum} font-semibold`}>{f.money(gross)}</td>
                        <td className={td} />
                        <td className={`${td} whitespace-nowrap`}>{f.date(m.last_order_on)}</td>
                      </tr>
                      {m.lines.map((l, n) => (
                        <tr key={`${m.merchant_id}-${l.good_id}-${n}`}>
                          <td className={`${td} pl-6`}>{locale === 'en' && l.name_en ? l.name_en : l.name_bg}</td>
                          <td className={tdNum}>
                            {f.money(l.agreed_price_cents ?? l.last_price_cents)} / {f.unit(l.unit)}
                          </td>
                          <td className={tdNum}>{f.money(l.agreed_price_gross_cents ?? l.last_price_gross_cents)}</td>
                          <td className={tdNum}>{f.qty(l.quantity_milli, l.unit)}</td>
                          <td className={tdNum}>{f.money(l.net_cents)}</td>
                          <td className={tdNum}>{f.money(l.gross_cents)}</td>
                          <td className={tdNum}>{l.orders}</td>
                          <td className={`${td} whitespace-nowrap`}>{f.date(l.last_order_on)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                <tr className="border-t-2 border-neutral-300 bg-neutral-100 font-semibold">
                  <td className={td} colSpan={4}>
                    {t('totalAll')}
                  </td>
                  <td className={tdNum}>{f.money(d.totals.netCents)}</td>
                  <td className={tdNum}>{f.money(d.merchants.reduce((sum, m) => sum + m.lines.reduce((x, l) => x + Number(l.gross_cents), 0), 0))}</td>
                  <td className={td} colSpan={2} />
                </tr>
              </Table>
            </Card>
          ) : (
            <Empty>{t('none')}</Empty>
          )}
        </div>
      )}
    </Loaded>
  );
}
