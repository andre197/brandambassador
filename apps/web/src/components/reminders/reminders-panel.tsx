'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api-client';
import type { Merchant, Producer, Reminder } from '@/lib/types';
import { Badge, Btn, Card, Check, ConfirmBtn, Empty, ErrorNote, In, Modal, Sel, Table, td, todayIso, Txt, useAction, useData, useFmt } from '../kit';
import { useMe } from '../session';

function ReminderEditor({ reminder, merchantId, onDone }: { reminder: Reminder | null; merchantId?: string; onDone(): void }) {
  const t = useTranslations('reminders');
  const tc = useTranslations('common');
  const action = useAction();
  const merchants = useData<Merchant[]>('/merchants');
  const producers = useData<Producer[]>('/producers');
  const [form, setForm] = useState({
    merchant_id: reminder?.merchant_id ?? merchantId ?? '',
    producer_id: reminder?.producer_id ?? '',
    due_on: reminder?.due_on ?? todayIso(),
    message: reminder?.message ?? '',
    remind_days_before: String(reminder?.remind_days_before ?? 3),
    send_now: !reminder,
  });
  const set = (k: keyof typeof form, v: string | boolean) => setForm({ ...form, [k]: v });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...form, producer_id: form.producer_id || null };
    if (await action.run(() => api(reminder ? `/reminders/${reminder.id}` : '/reminders', { method: reminder ? 'PUT' : 'POST', body }))) onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Sel label={t('merchant')} required value={form.merchant_id} onChange={(e) => set('merchant_id', e.target.value)} error={action.field('merchant_id')}>
          <option value="">{tc('choose')}</option>
          {(merchants.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Sel>
        <Sel label={t('producer')} value={form.producer_id} onChange={(e) => set('producer_id', e.target.value)} hint={t('producerHint')}>
          <option value="">{t('anyProducer')}</option>
          {(producers.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Sel>
        <In type="date" label={t('dueOn')} required value={form.due_on} onChange={(e) => set('due_on', e.target.value)} error={action.field('due_on')} />
        <In label={t('daysBefore')} inputMode="numeric" value={form.remind_days_before} onChange={(e) => set('remind_days_before', e.target.value)} error={action.field('remind_days_before')} hint={t('daysBeforeHint')} />
      </div>
      <Txt label={t('message')} value={form.message} onChange={(e) => set('message', e.target.value)} />
      <Check label={t('sendNow')} checked={form.send_now} onChange={(e) => set('send_now', e.target.checked)} />
      <ErrorNote>{action.error}</ErrorNote>
      <Btn tone="primary" type="submit" busy={action.busy}>
        {reminder ? tc('save') : t('create')}
      </Btn>
    </form>
  );
}

/** Order reminders: the admin plans them, the merchant sees and closes them. */
export function RemindersPanel({ merchantId }: { merchantId?: string }) {
  const t = useTranslations('reminders');
  const tc = useTranslations('common');
  const ts = useTranslations('reminderStatus');
  const f = useFmt();
  const me = useMe();
  const admin = me.role === 'admin';
  const state = useData<Reminder[]>(`/reminders${merchantId ? `?merchant_id=${merchantId}` : ''}`);
  const action = useAction();
  const [editing, setEditing] = useState<Reminder | 'new' | null>(null);
  const today = todayIso();

  const setStatus = async (id: string, status: string) => {
    if (await action.run(() => api(`/reminders/${id}/status`, { method: 'PATCH', body: { status } }))) void state.reload();
  };

  return (
    <Card
      title={t('title')}
      actions={
        admin ? (
          <Btn size="sm" tone="primary" onClick={() => setEditing('new')}>
            + {t('new')}
          </Btn>
        ) : null
      }
    >
      <p className="mb-3 text-[13px] text-neutral-500">{admin ? t('adminHint') : t('merchantHint')}</p>
      {state.data?.length ? (
        <Table head={[t('dueOn'), ...(admin && !merchantId ? [t('merchant')] : []), t('producer'), t('message'), t('status'), t('lastSent'), tc('actions')]}>
          {state.data.map((r) => (
            <tr key={r.id}>
              <td className={`${td} whitespace-nowrap font-medium`}>
                {f.date(r.due_on)}
                {r.status === 'open' && r.due_on < today ? (
                  <div>
                    <Badge tone="red">{t('late')}</Badge>
                  </div>
                ) : null}
              </td>
              {admin && !merchantId ? <td className={td}>{r.merchant_name}</td> : null}
              <td className={td}>{r.producer_name ?? t('anyProducer')}</td>
              <td className={`${td} text-[13px]`}>{r.message ?? '-'}</td>
              <td className={td}>
                <Badge tone={r.status === 'open' ? 'amber' : r.status === 'done' ? 'green' : 'gray'}>{ts(r.status)}</Badge>
              </td>
              <td className={`${td} whitespace-nowrap text-[13px]`}>{f.dateTime(r.last_sent_at)}</td>
              <td className={td}>
                <div className="flex flex-wrap gap-2">
                  {!admin && r.status === 'open' ? (
                    <>
                      <Link href={r.producer_id ? `/orders/new?producer_id=${r.producer_id}` : '/orders/new'}>
                        <Btn size="sm" tone="primary">
                          {t('order')}
                        </Btn>
                      </Link>
                      <Btn size="sm" onClick={() => void setStatus(r.id, 'done')}>
                        {t('markDone')}
                      </Btn>
                    </>
                  ) : null}
                  {admin ? (
                    <>
                      <Btn size="sm" onClick={() => setEditing(r)}>
                        {tc('edit')}
                      </Btn>
                      {r.status === 'open' ? (
                        <Btn size="sm" onClick={() => void setStatus(r.id, 'cancelled')}>
                          {t('cancel')}
                        </Btn>
                      ) : (
                        <Btn size="sm" onClick={() => void setStatus(r.id, 'open')}>
                          {t('reopen')}
                        </Btn>
                      )}
                      <ConfirmBtn
                        onConfirm={async () => {
                          if (await action.run(() => api(`/reminders/${r.id}`, { method: 'DELETE' }))) void state.reload();
                        }}
                      >
                        {tc('delete')}
                      </ConfirmBtn>
                    </>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      ) : state.data ? (
        <Empty />
      ) : null}
      <ErrorNote>{action.error ?? state.error}</ErrorNote>
      <Modal title={editing === 'new' ? t('new') : t('edit')} open={editing !== null} onClose={() => setEditing(null)} wide>
        {editing !== null ? (
          <ReminderEditor
            reminder={editing === 'new' ? null : editing}
            merchantId={merchantId}
            onDone={() => {
              setEditing(null);
              void state.reload();
            }}
          />
        ) : null}
      </Modal>
    </Card>
  );
}
