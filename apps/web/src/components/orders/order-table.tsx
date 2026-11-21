'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { OrderListRow } from '@/lib/types';
import { CommissionBadge, OrderStatusBadge, PaymentBadge } from '../badges';
import { Empty, Table, td, tdNum, useFmt } from '../kit';
import { useMe } from '../session';

/** Orders as a table; columns adapt to the role (merchants never see the commission). */
export function OrderTable({ rows, compact }: { rows: OrderListRow[]; compact?: boolean }) {
  const t = useTranslations('orders');
  const me = useMe();
  const f = useFmt();
  if (!rows.length) return <Empty />;
  const showProducer = me.role !== 'producer';
  const showMerchant = me.role !== 'merchant';
  const showCommission = me.role !== 'merchant';
  const head = [
    t('number'),
    t('date'),
    ...(showProducer ? [t('producer')] : []),
    ...(showMerchant ? [t('merchant')] : []),
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
          {showMerchant ? <td className={td}>{o.merchant_name}</td> : null}
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
                  {f.money(o.calc.commissionCents)} <span className="text-[12px] text-neutral-500">({f.pct(o.calc.commissionBp)})</span>
                </span>
                <CommissionBadge status={o.calc.commissionStatus} />
              </div>
            </td>
          ) : null}
        </tr>
      ))}
    </Table>
  );
}
