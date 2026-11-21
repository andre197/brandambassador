'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { Btn, ErrorNote, In, useAction } from '@/components/kit';
import { setLocaleCookie } from '@/components/shell';
import { api } from '@/lib/api-client';

export default function LoginPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const action = useAction();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await action.run(() => api<{ user: { locale: string } }>('/auth/login', { method: 'POST', body: { login, password } }));
    if (r) {
      setLocaleCookie(r.user.locale);
      router.replace('/');
      router.refresh();
    }
  };

  return (
    <AuthFrame title={t('loginTitle')}>
      <form onSubmit={submit} className="space-y-4">
        <In label={t('login')} type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" required value={login} onChange={(e) => setLogin(e.target.value)} />
        <In label={t('password')} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorNote>{action.error}</ErrorNote>
        <Btn tone="primary" type="submit" busy={action.busy} className="w-full">
          {t('submit')}
        </Btn>
        <p className="text-center text-[13px]">
          <Link href="/forgot-password" className="text-neutral-600 underline hover:text-neutral-900">
            {t('forgot')}
          </Link>
        </p>
      </form>
    </AuthFrame>
  );
}
