'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { Btn, ErrorNote, In, OkNote, useAction } from '@/components/kit';
import { api } from '@/lib/api-client';

function SetPasswordForm() {
  const t = useTranslations('auth');
  const token = useSearchParams().get('token') ?? '';
  const action = useAction();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState(false);
  const [mismatch, setMismatch] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMismatch(password !== repeat);
    if (password !== repeat) return;
    if (await action.run(() => api('/auth/set-password', { method: 'POST', body: { token, password } }))) setDone(true);
  };

  if (done) {
    return (
      <>
        <OkNote>{t('passwordSet')}</OkNote>
        <Link href="/login" className="block text-center text-[14px] font-medium text-ink underline">
          {t('backToLogin')}
        </Link>
      </>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <In label={t('newPassword')} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={action.field('password')} hint={t('passwordHint')} />
      <In label={t('repeatPassword')} type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} error={mismatch ? t('mismatch') : null} />
      <ErrorNote>{action.error}</ErrorNote>
      <Btn tone="primary" type="submit" busy={action.busy} className="w-full">
        {t('setPassword')}
      </Btn>
    </form>
  );
}

export default function SetPasswordPage() {
  const t = useTranslations('auth');
  return (
    <AuthFrame title={t('setPasswordTitle')}>
      <Suspense>
        <SetPasswordForm />
      </Suspense>
    </AuthFrame>
  );
}
