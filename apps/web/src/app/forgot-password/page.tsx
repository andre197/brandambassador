'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { Btn, ErrorNote, In, OkNote, useAction } from '@/components/kit';
import { api } from '@/lib/api-client';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const action = useAction();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => api('/auth/forgot', { method: 'POST', body: { email } }))) setSent(true);
  };

  return (
    <AuthFrame title={t('forgotTitle')}>
      {sent ? (
        <OkNote>{t('forgotSent')}</OkNote>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-[14px] text-neutral-600">{t('forgotIntro')}</p>
          <In label={t('email')} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={action.field('email')} />
          <ErrorNote>{action.error}</ErrorNote>
          <Btn tone="primary" type="submit" busy={action.busy} className="w-full">
            {t('forgotSubmit')}
          </Btn>
        </form>
      )}
      <p className="text-center text-[13px]">
        <Link href="/login" className="text-neutral-600 underline hover:text-neutral-900">
          {t('backToLogin')}
        </Link>
      </p>
    </AuthFrame>
  );
}
