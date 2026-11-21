'use client';

import Link from 'next/link';
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
    lines: { good_id: string | null; name_bg: string; name_en: string | null; unit: string; quantity_milli: number; net_cents: number; orders: number; last_order_on: string; last_price_cents: number; agreed_price_cents: number | null }[];
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
            d.merchants.map((m) => (
              <Card
                key={m.merchant_id}
                title={
                  <Link href={`/merchants/${m.merchant_id}`} className="normal-case hover:underline">
                    {m.merchant_name}
                  </Link>
                }
                actions={
                  <>
                    {m.pair_status !== 'attracted' ? <Badge>{tp(m.pair_status as never)}</Badge> : null}
                    {m.active_buyer ? <Badge tone="green">{t('active')}</Badge> : <Badge>{t('inactive')}</Badge>}
                    <span className="text-[13px] tabular-nums text-neutral-700">{f.money(m.net_cents)}</span>
                  </>
                }
              >
                <p className="mb-3 text-[13px] text-neutral-500">
                  {m.merchant_address} · {t('lastOrder', { date: f.date(m.last_order_on) })}
                </p>
                <Table head={[t('good'), t('price'), t('quantity'), t('net'), t('orders'), t('lastOrderCol')]}>
                  {m.lines.map((l, i) => (
                    <tr key={`${l.good_id}-${i}`}>
                      <td className={td}>{locale === 'en' && l.name_en ? l.name_en : l.name_bg}</td>
                      <td className={tdNum}>
                        {f.money(l.agreed_price_cents ?? l.last_price_cents)} / {f.unit(l.unit)}
                      </td>
                      <td className={tdNum}>{f.qty(l.quantity_milli, l.unit)}</td>
                      <td className={tdNum}>{f.money(l.net_cents)}</td>
                      <td className={tdNum}>{l.orders}</td>
                      <td className={`${td} whitespace-nowrap`}>{f.date(l.last_order_on)}</td>
                    </tr>
                  ))}
                </Table>
              </Card>
            ))
          ) : (
            <Empty>{t('none')}</Empty>
          )}
        </div>
      )}
    </Loaded>
  );
}
