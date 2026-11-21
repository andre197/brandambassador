'use client';

import type { CommissionStatus, OrderStatus, PaymentStatus, RequestStatus } from '@ba/shared';
import { useTranslations } from 'next-intl';
import { Badge, type Tone } from './kit';

const ORDER: Record<OrderStatus, Tone> = { new: 'blue', confirmed: 'amber', delivered: 'green', cancelled: 'gray' };
const PAYMENT: Record<PaymentStatus, Tone> = { unpaid: 'gray', partial: 'amber', paid: 'green' };
const COMMISSION: Record<CommissionStatus, Tone> = { none: 'gray', awaiting_payment: 'gray', due: 'amber', overdue: 'red', settled: 'green' };
const REQUEST: Record<RequestStatus, Tone> = { pending: 'amber', approved: 'green', rejected: 'gray' };

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations('orderStatus');
  return <Badge tone={ORDER[status]}>{t(status)}</Badge>;
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const t = useTranslations('paymentStatus');
  return <Badge tone={PAYMENT[status]}>{t(status)}</Badge>;
}

export function CommissionBadge({ status }: { status: CommissionStatus | undefined }) {
  const t = useTranslations('commissionStatus');
  if (!status) return null;
  return <Badge tone={COMMISSION[status]}>{t(status)}</Badge>;
}

export function RequestBadge({ status }: { status: RequestStatus }) {
  const t = useTranslations('requestStatus');
  return <Badge tone={REQUEST[status]}>{t(status)}</Badge>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  const t = useTranslations('common');
  return active ? <Badge tone="green">{t('active')}</Badge> : <Badge>{t('inactive')}</Badge>;
}
