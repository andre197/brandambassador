'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api-client';
import { Btn, Card, ErrorNote, In, OkNote, useAction } from './kit';

export function PasswordCard() {
  const t = useTranslations('profile');
  const action = useAction();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [done, setDone] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setDone(false);
    if (await action.run(() => api('/auth/password', { method: 'POST', body: { current, next } }))) {
      setDone(true);
      setCurrent('');
      setNext('');
    }
  };
  return (
    <Card title={t('password')}>
      <form onSubmit={submit} className="space-y-3">
        <In label={t('currentPassword')} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={action.field('current')} />
        <In label={t('newPassword')} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={action.field('next')} hint={t('passwordHint')} />
        {done ? <OkNote>{t('passwordChanged')}</OkNote> : null}
        <ErrorNote>{action.error}</ErrorNote>
        <Btn type="submit" busy={action.busy}>
          {t('changePassword')}
        </Btn>
      </form>
    </Card>
  );
}
