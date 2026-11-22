'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Btn, cx, Empty, Loaded, PageHeader, useData, useFmt } from '@/components/kit';
import { api } from '@/lib/api-client';
import type { NotificationRow } from '@/lib/types';

export default function NotificationsPage() {
  const t = useTranslations('notifications');
  const tr = useTranslations('roles');
  const f = useFmt();
  const router = useRouter();
  // The message key is built from the notification type, so it is not known statically.
  const msg = t as unknown as (key: string, values: Record<string, string>) => string;
  const state = useData<{ items: NotificationRow[]; unread: number }>('/notifications');

  /** Message parameters: money as euro, dates formatted, everything else as text. */
  const params = (n: NotificationRow) => {
    const d = n.data;
    const money = (k: string) => (typeof d[k] === 'number' ? f.money(d[k] as number) : '');
    return {
      number: String(d.number ?? ''),
      producer: String(d.producer ?? ''),
      merchant: String(d.merchant ?? ''),
      good: String(d.good ?? ''),
      reason: String(d.reason ?? ''),
      response: String(d.response ?? ''),
      message: String(d.message ?? ''),
      description: String(d.description ?? ''),
      by: d.by ? tr(d.by as never) : '',
      net: money('net'),
      amount: money('amount'),
      price: money('price'),
      current: money('current'),
      proposed: money('proposed'),
      decision: String(d.decision ?? ''),
      due: f.date(d.due as string),
      end: f.date(d.end as string),
      notice: f.date(d.notice as string),
      paidOn: f.date(d.paidOn as string),
      commissionDueOn: f.date(d.commissionDueOn as string),
      planned: f.date(d.planned as string),
      delivered: f.date(d.delivered as string),
      hasProducer: d.producer ? 'yes' : 'no',
      kind: String(d.kind ?? 'agreed'),
    };
  };

  const markAll = async () => {
    await api('/notifications/read', { method: 'POST', body: { ids: null } });
    await state.reload();
    router.refresh();
  };
  const open = async (n: NotificationRow) => {
    if (!n.read_at) await api('/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => undefined);
    router.refresh();
  };

  return (
    <>
      <PageHeader title={t('title')} actions={state.data?.unread ? <Btn onClick={() => void markAll()}>{t('markAll')}</Btn> : null} />
      <Loaded state={state}>
        {(d) =>
          d.items.length ? (
            <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200 bg-white shadow-sm">
              {d.items.map((n) => {
                const body = (
                  <div className={cx('flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between', !n.read_at && 'bg-gold-soft/40')}>
                    <div className="min-w-0">
                      <p className={cx('text-[14px]', !n.read_at && 'font-semibold')}>{msg(`types.${n.type}.title`, params(n))}</p>
                      <p className="text-[13px] text-neutral-600">{msg(`types.${n.type}.body`, params(n))}</p>
                    </div>
                    <span className="shrink-0 text-[12px] text-neutral-500">{f.dateTime(n.created_at)}</span>
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link href={n.link} onClick={() => void open(n)} className="block hover:bg-neutral-50">
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty />
          )
        }
      </Loaded>
    </>
  );
}
