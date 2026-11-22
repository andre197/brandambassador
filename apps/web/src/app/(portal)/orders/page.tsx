'use client';

import { ORDER_STATUSES } from '@ba/shared';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Btn, downloadCsv, Empty, ExportButtons, In, Loaded, PageHeader, printTable, Sel, Table, Tabs, td, tdNum, useData, useFmt } from '@/components/kit';
import { OrderTable } from '@/components/orders/order-table';
import { useMe } from '@/components/session';
import type { Merchant, OrderLine, OrderListRow, Producer } from '@/lib/types';

type View = 'orders' | 'lines';

const today = () => new Date().toISOString().slice(0, 10);

/** The extended view: one row for each good of the orders the filters show. */
function OrderLinesTable({ rows }: { rows: OrderLine[] }) {
  const t = useTranslations('orders');
  const locale = useLocale();
  const f = useFmt();
  if (!rows.length) return <Empty />;
  const net = rows.reduce((s, r) => s + Number(r.line_net_cents), 0);
  const gross = rows.reduce((s, r) => s + Number(r.line_gross_cents), 0);
  return (
    <Table head={[t('eik'), t('merchant'), t('shopAlias'), t('address'), t('good'), t('quantity'), t('amountNet'), t('amountGross')]}>
      {rows.map((r) => (
        <tr key={r.id} className="hover:bg-neutral-50">
          <td className={`${td} whitespace-nowrap`}>{r.merchant_eik}</td>
          <td className={td}>
            <Link href={`/orders/${r.order_id}`} className="font-medium text-ink hover:underline">
              {r.merchant_name}
            </Link>
            <div className="text-[12px] text-neutral-500">
              №{r.number} · {f.date(r.order_date)}
            </div>
          </td>
          <td className={td}>{r.shop_alias ?? '-'}</td>
          <td className={td}>{r.address}</td>
          <td className={td}>{locale === 'en' && r.name_en ? r.name_en : r.name_bg}</td>
          <td className={`${tdNum} whitespace-nowrap`}>{f.qty(r.quantity_milli, r.unit)}</td>
          <td className={tdNum}>{f.money(r.line_net_cents)}</td>
          <td className={tdNum}>{f.money(r.line_gross_cents)}</td>
        </tr>
      ))}
      <tr className="bg-neutral-50 font-semibold">
        <td className={td} colSpan={6}>
          {t('total')}
        </td>
        <td className={tdNum}>{f.money(net)}</td>
        <td className={tdNum}>{f.money(gross)}</td>
      </tr>
    </Table>
  );
}

function OrdersList() {
  const t = useTranslations('orders');
  const ts = useTranslations('orderStatus');
  const tps = useTranslations('paymentStatus');
  const tc = useTranslations('common');
  const me = useMe();
  const locale = useLocale();
  const f = useFmt();
  const sp = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [producer, setProducer] = useState(sp.get('producer_id') ?? '');
  const [merchant, setMerchant] = useState(sp.get('merchant_id') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [view, setView] = useState<View>('orders');
  // The extended view is for the producer and the admin.
  const canExtend = me.role !== 'merchant';

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (producer) params.set('producer_id', producer);
  if (merchant) params.set('merchant_id', merchant);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const state = useData<OrderListRow[]>(`/orders?${params.toString()}`);
  const lines = useData<OrderLine[]>(canExtend && view === 'lines' ? `/orders/lines?${params.toString()}` : null);
  const producers = useData<Producer[]>(me.role === 'producer' ? null : '/producers');
  const merchants = useData<Merchant[]>(me.role === 'merchant' ? null : '/merchants');

  /** A line under the export title: the filters in use. */
  const subtitle = [
    status ? ts(status as never) : '',
    producer ? producers.data?.find((p) => p.id === producer)?.name : '',
    merchant ? merchants.data?.find((m) => m.id === merchant)?.name : '',
    from || to ? `${from ? f.date(from) : ''} - ${to ? f.date(to) : ''}` : '',
    q ? `"${q}"` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  // The same columns as the orders table.
  const showProducer = me.role !== 'producer';
  const showMerchant = me.role !== 'merchant';
  const showCommission = me.role !== 'merchant';
  const ordersTable = (rows: OrderListRow[]) => {
    const head = [t('number'), t('date'), ...(showProducer ? [t('producer')] : []), ...(showMerchant ? [t('merchant')] : []), t('net'), t('gross'), t('status'), t('payment'), ...(showCommission ? [t('commission')] : [])];
    const body = rows.map((o) => [
      o.number,
      f.date(o.order_date),
      ...(showProducer ? [o.producer_name] : []),
      ...(showMerchant ? [o.merchant_name] : []),
      f.money(o.calc.baseNetCents),
      f.money(o.calc.payableGrossCents),
      ts(o.status),
      tps(o.calc.paymentStatus),
      ...(showCommission ? [`${f.money(o.calc.commissionCents)} (${f.commission(o.calc.commissionType, o.calc.commissionBp, o.calc.commissionUnitCents, o.calc.commissionByGoods)})`] : []),
    ]);
    const firstMoney = 2 + (showProducer ? 1 : 0) + (showMerchant ? 1 : 0);
    return { head, body, numeric: [0, firstMoney, firstMoney + 1, ...(showCommission ? [head.length - 1] : [])] };
  };
  const linesTable = (rows: OrderLine[]) => ({
    head: [t('eik'), t('merchant'), t('shopAlias'), t('address'), t('good'), t('quantity'), t('amountNet'), t('amountGross')],
    body: rows.map((r) => [r.merchant_eik, r.merchant_name, r.shop_alias ?? '', r.address, locale === 'en' && r.name_en ? r.name_en : r.name_bg, f.qty(r.quantity_milli, r.unit), f.money(r.line_net_cents), f.money(r.line_gross_cents)]),
    numeric: [5, 6, 7],
    total: [rows.reduce((s, r) => s + Number(r.line_net_cents), 0), rows.reduce((s, r) => s + Number(r.line_gross_cents), 0)],
  });

  // CSV keeps plain numbers (euro with a dot) so a spreadsheet can add them up.
  const eur = (cents: number | undefined) => ((cents ?? 0) / 100).toFixed(2);
  const exportOrders = (kind: 'csv' | 'pdf') => {
    const rows = state.data ?? [];
    const x = ordersTable(rows);
    if (kind === 'pdf') return void printTable(t('title'), x.head, x.body, { subtitle, numeric: x.numeric });
    downloadCsv(`orders-${today()}.csv`, [
      x.head,
      ...rows.map((o) => [
        o.number,
        o.order_date,
        ...(showProducer ? [o.producer_name] : []),
        ...(showMerchant ? [o.merchant_name] : []),
        eur(o.calc.baseNetCents),
        eur(o.calc.payableGrossCents),
        ts(o.status),
        tps(o.calc.paymentStatus),
        ...(showCommission ? [eur(o.calc.commissionCents)] : []),
      ]),
    ]);
  };
  const exportLines = (kind: 'csv' | 'pdf') => {
    const rows = lines.data ?? [];
    const x = linesTable(rows);
    if (kind === 'pdf') return void printTable(`${t('title')} - ${t('views.lines')}`, x.head, x.body, { subtitle, numeric: x.numeric, footer: [t('total'), '', '', '', '', '', f.money(x.total[0]), f.money(x.total[1])] });
    downloadCsv(`order-lines-${today()}.csv`, [x.head, ...rows.map((r, i) => [r.merchant_eik, r.merchant_name, r.shop_alias ?? '', r.address, x.body[i]![4], x.body[i]![5], eur(r.line_net_cents), eur(r.line_gross_cents)])]);
  };

  const exportButtons =
    view === 'lines' ? (
      <ExportButtons onCsv={() => exportLines('csv')} onPdf={() => exportLines('pdf')} disabled={!lines.data?.length} />
    ) : (
      <ExportButtons onCsv={() => exportOrders('csv')} onPdf={() => exportOrders('pdf')} disabled={!state.data?.length} />
    );

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
      <div className="flex flex-wrap items-end justify-between gap-2">
        {canExtend ? (
          <Tabs value={view} onChange={(v) => setView(v as View)} options={(['orders', 'lines'] as View[]).map((v) => ({ value: v, label: t(`views.${v}`) }))} />
        ) : (
          <span />
        )}
        <div className="mb-4">{exportButtons}</div>
      </div>
      {view === 'lines' && canExtend ? (
        <Loaded state={lines}>{(rows) => <OrderLinesTable rows={rows} />}</Loaded>
      ) : (
        <Loaded state={state}>{(rows) => <OrderTable rows={rows} />}</Loaded>
      )}
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
