'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import type { Me, Role } from '@/lib/types';
import { cx } from './kit';
import { SessionProvider } from './session';

type NavKey = 'dashboard' | 'orders' | 'producers' | 'merchants' | 'goods' | 'requests' | 'reminders' | 'commissions' | 'notifications' | 'settings' | 'profile' | 'trade';

const NAV: Record<Role, { href: string; key: NavKey }[]> = {
  admin: [
    { href: '/', key: 'dashboard' },
    { href: '/orders', key: 'orders' },
    { href: '/producers', key: 'producers' },
    { href: '/merchants', key: 'merchants' },
    { href: '/goods', key: 'goods' },
    { href: '/requests', key: 'requests' },
    { href: '/reminders', key: 'reminders' },
    { href: '/commissions', key: 'commissions' },
    { href: '/notifications', key: 'notifications' },
    { href: '/settings', key: 'settings' },
  ],
  producer: [
    { href: '/', key: 'dashboard' },
    { href: '/orders', key: 'orders' },
    { href: '/goods', key: 'goods' },
    { href: '/merchants', key: 'trade' },
    { href: '/requests', key: 'requests' },
    { href: '/commissions', key: 'commissions' },
    { href: '/notifications', key: 'notifications' },
    { href: '/profile', key: 'profile' },
  ],
  merchant: [
    { href: '/', key: 'dashboard' },
    { href: '/orders', key: 'orders' },
    { href: '/producers', key: 'producers' },
    { href: '/requests', key: 'requests' },
    { href: '/reminders', key: 'reminders' },
    { href: '/notifications', key: 'notifications' },
    { href: '/profile', key: 'profile' },
  ],
};

export function setLocaleCookie(l: string) {
  document.cookie = `locale=${l}; path=/; max-age=31536000; samesite=lax`;
}

export function LanguageSwitch({ onChange }: { onChange?(l: string): void }) {
  const locale = useLocale();
  const router = useRouter();
  return (
    <div className="flex items-center gap-1 text-[12px] font-semibold uppercase">
      {['bg', 'en'].map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => {
            setLocaleCookie(l);
            onChange?.(l);
            router.refresh();
          }}
          className={cx('rounded px-1.5 py-1', l === locale ? 'bg-ink text-white' : 'text-neutral-500 hover:text-neutral-900')}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function Shell({ me, unread, children }: { me: Me; unread: number; children: ReactNode }) {
  const t = useTranslations('nav');
  const tr = useTranslations('roles');
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const active = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <SessionProvider me={me}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
        <aside className={cx('fixed inset-y-0 left-0 z-40 w-[232px] border-r border-neutral-200 bg-white transition-transform lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
          <Link href="/" className="flex h-16 flex-col justify-center border-b border-neutral-200 px-4">
            <span className="text-[15px] font-semibold tracking-wide text-ink">Brand Ambassador</span>
            <span className="text-[12px] text-gold">{tr(me.role)}</span>
          </Link>
          <nav className="flex flex-col gap-0.5 p-3">
            {NAV[me.role].map((n) => (
              <Link
                key={n.key}
                href={n.href}
                className={cx('flex items-center justify-between rounded-md px-3 py-2 text-[14px] transition', active(n.href) ? 'bg-gold-soft font-semibold text-ink' : 'text-neutral-700 hover:bg-neutral-100')}
              >
                {t(n.key)}
                {n.key === 'notifications' && unread > 0 ? <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">{unread}</span> : null}
              </Link>
            ))}
          </nav>
        </aside>
        {open ? <button type="button" aria-label={t('close')} className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} /> : null}

        <div className="min-w-0">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-neutral-200 bg-white/95 px-4 backdrop-blur">
            <button type="button" className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 lg:hidden" onClick={() => setOpen(true)} aria-label={t('menu')}>
              ☰
            </button>
            <div className="flex-1" />
            <Link href="/notifications" className="relative rounded-md px-2 py-1 text-[13px] text-neutral-600 hover:bg-neutral-100" aria-label={t('notifications')}>
              🔔{unread > 0 ? <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">{unread}</span> : null}
            </Link>
            <LanguageSwitch onChange={(l) => void api('/auth/locale', { method: 'POST', body: { locale: l } }).catch(() => undefined)} />
            <span className="hidden max-w-[220px] truncate text-[13px] text-neutral-500 md:inline">{me.name ?? me.email}</span>
            <button
              type="button"
              className="text-[13px] text-neutral-600 hover:text-red-700"
              onClick={async () => {
                await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
                router.replace('/login');
                router.refresh();
              }}
            >
              {t('logout')}
            </button>
          </header>
          <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </SessionProvider>
  );
}
