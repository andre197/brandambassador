'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api-client';
import type { UserRow } from '@/lib/types';
import { ActiveBadge } from '../badges';
import { Badge, Btn, Card, ConfirmBtn, Empty, ErrorNote, In, OkNote, Sel, Table, td, useAction, useData, useFmt } from '../kit';
import { useMe } from '../session';

/** Logins for a producer, a merchant, or (with neither) the administrators. */
export function UsersCard({ producerId, merchantId }: { producerId?: string; merchantId?: string }) {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const f = useFmt();
  const me = useMe();
  const query = producerId ? `?producer_id=${producerId}` : merchantId ? `?merchant_id=${merchantId}` : '';
  const state = useData<UserRow[]>(`/users${query}`);
  const action = useAction();
  const [form, setForm] = useState({ email: '', name: '', locale: 'bg', password: '' });
  const [note, setNote] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const r = await action.run(() => api('/users', { method: 'POST', body: { ...form, producer_id: producerId, merchant_id: merchantId } }));
    if (r) {
      setNote(form.password ? t('created') : t('invited', { email: form.email }));
      setForm({ email: '', name: '', locale: 'bg', password: '' });
      void state.reload();
    }
  };
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    if (await action.run(fn)) {
      if (done) setNote(done);
      void state.reload();
    }
  };

  return (
    <Card title={producerId || merchantId ? t('title') : t('admins')}>
      <p className="mb-3 text-[13px] text-neutral-500">{producerId || merchantId ? t('hint') : t('adminsHint')}</p>
      {state.data?.length ? (
        <Table head={[t('email'), t('name'), t('lastLogin'), '', tc('actions')]}>
          {state.data.map((u) => (
            <tr key={u.id}>
              <td className={td}>{u.email}</td>
              <td className={td}>{u.name ?? '-'}</td>
              <td className={`${td} whitespace-nowrap`}>{f.dateTime(u.last_login_at)}</td>
              <td className={td}>
                <div className="flex flex-wrap gap-1">
                  <ActiveBadge active={u.active} />
                  {!u.has_password ? <Badge tone="amber">{t('noPassword')}</Badge> : null}
                </div>
              </td>
              <td className={td}>
                {u.id !== me.id ? (
                  <div className="flex flex-wrap gap-2">
                    <Btn size="sm" onClick={() => void act(() => api(`/users/${u.id}/invite`, { method: 'POST' }), t('invited', { email: u.email }))}>
                      {t('sendLink')}
                    </Btn>
                    <Btn size="sm" onClick={() => void act(() => api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }))}>
                      {u.active ? t('deactivate') : t('activate')}
                    </Btn>
                    <ConfirmBtn onConfirm={() => void act(() => api(`/users/${u.id}`, { method: 'DELETE' }))}>{tc('delete')}</ConfirmBtn>
                  </div>
                ) : (
                  <span className="text-[12px] text-neutral-500">{t('you')}</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : state.data ? (
        <Empty>{t('none')}</Empty>
      ) : null}
      <form onSubmit={add} className="mt-4 grid gap-2 sm:grid-cols-[2fr_1.5fr_1fr_1.5fr_auto] sm:items-end">
        <In label={t('email')} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={action.field('email')} />
        <In label={t('name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Sel label={t('language')} value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })}>
          <option value="bg">Български</option>
          <option value="en">English</option>
        </Sel>
        <In label={t('password')} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={action.field('password')} placeholder={t('passwordEmpty')} />
        <Btn type="submit" tone="primary" busy={action.busy}>
          {t('add')}
        </Btn>
      </form>
      <div className="mt-3 space-y-2">
        <OkNote>{note}</OkNote>
        <ErrorNote>{action.error}</ErrorNote>
      </div>
    </Card>
  );
}
