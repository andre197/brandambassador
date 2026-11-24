'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { OrderListRow } from '@/lib/types';
import { CommissionBadge, OrderStatusBadge, PaymentBadge } from '../badges';
import { Empty, Table, td, tdNum, useFmt } from '../kit';
import { useMe } from '../session';

type Qty = { unit: string; quantity_milli: number };

/** Adds up quantities per unit (pieces and kilograms are never added together). */
export function sumQuantities(rows: OrderListRow[]): Qty[] {
  const by = new Map<string, number>();
  for (const o of rows) for (const q of o.quantities ?? []) by.set(q.unit, (by.get(q.unit) ?? 0) + Number(q.quantity_milli));
  return [...by].map(([unit, quantity_milli]) => ({ unit, quantity_milli }));
}

/**
 * Orders as a table; columns adapt to the role (merchants never see the commission).
 * `totals`: a last row with the number of orders and the sums of the quantity and money columns.
 */
export function OrderTable({ rows, compact, totals }: { rows: OrderListRow[]; compact?: boolean; totals?: boolean }) {
  const t = useTranslations('orders');
  const me = useMe();
  const f = useFmt();
  if (!rows.length) return <Empty />;
  const showProducer = me.role !== 'producer';
  const showMerchant = me.role !== 'merchant';
  const showCommission = me.role !== 'merchant';
  const qty = (list: Qty[] | undefined) => (list ?? []).map((q) => f.qty(q.quantity_milli, q.unit)).join(' + ');
  const head = [
    t('number'),
    t('date'),
    ...(showProducer ? [t('producer')] : []),
    ...(showMerchant ? [t('merchant')] : []),
    ...(compact ? [] : [t('quantity')]),
    t('net'),
    ...(compact ? [] : [t('gross')]),
    t('status'),
    t('payment'),
    ...(showCommission ? [t('commission')] : []),
  ];
  return (
    <Table head={head}>
      {rows.map((o) => (
        <tr key={o.id} className="hover:bg-neutral-50">
          <td className={td}>
            <Link href={`/orders/${o.id}`} className="font-medium text-ink hover:underline">
              №{o.number}
            </Link>
            {o.merchant_ref ? <div className="text-[12px] text-neutral-500">{o.merchant_ref}</div> : null}
          </td>
          <td className={`${td} whitespace-nowrap`}>{f.date(o.order_date)}</td>
          {showProducer ? <td className={td}>{o.producer_name}</td> : null}
          {showMerchant ? (
            <td className={td}>
              {o.merchant_name}
              {o.shop_aliases ? <div className="text-[12px] text-neutral-500">{o.shop_aliases}</div> : null}
            </td>
          ) : null}
          {compact ? null : <td className={`${tdNum} whitespace-nowrap`}>{qty(o.quantities)}</td>}
          <td className={tdNum}>{f.money(o.calc.baseNetCents)}</td>
          {compact ? null : <td className={tdNum}>{f.money(o.calc.payableGrossCents)}</td>}
          <td className={td}>
            <OrderStatusBadge status={o.status} />
          </td>
          <td className={td}>
            <PaymentBadge status={o.calc.paymentStatus} />
          </td>
          {showCommission ? (
            <td className={td}>
              <div className="flex flex-col items-start gap-0.5">
                <span className="tabular-nums">
                  {f.money(o.calc.commissionCents)} <span className="text-[12px] text-neutral-500">({f.commission(o.calc.commissionType, o.calc.commissionBp, o.calc.commissionUnitCents, o.calc.commissionByGoods)})</span>
                </span>
                <CommissionBadge status={o.calc.commissionStatus} />
              </div>
            </td>
          ) : null}
        </tr>
      ))}
      {totals ? (
        <tr className="bg-neutral-50 font-semibold">
          <td className={td} colSpan={2 + (showProducer ? 1 : 0) + (showMerchant ? 1 : 0)}>
            {t('ordersCount', { count: rows.length })}
          </td>
          {compact ? null : <td className={`${tdNum} whitespace-nowrap`}>{qty(sumQuantities(rows))}</td>}
          <td className={tdNum}>{f.money(rows.reduce((s, o) => s + Number(o.calc.baseNetCents), 0))}</td>
          {compact ? null : <td className={tdNum}>{f.money(rows.reduce((s, o) => s + Number(o.calc.payableGrossCents), 0))}</td>}
          <td className={td} colSpan={2} />
          {showCommission ? <td className={tdNum}>{f.money(rows.reduce((s, o) => s + Number(o.calc.commissionCents ?? 0), 0))}</td> : null}
        </tr>
      ) : null}
    </Table>
  );
}
