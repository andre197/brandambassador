import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';
import { privateApi } from '@/lib/api-server';
import type { Me } from '@/lib/types';

/**
 * Server-side gate for every portal page. The API checks the session and the role on every
 * request too - this only avoids rendering pages for visitors who could not use them.
 */
export default async function PortalLayout({ children }: { children: ReactNode }) {
  const r = await privateApi<{ user: Me | null; unread: number }>('/auth/me').catch(() => null);
  if (!r?.user) redirect('/login');
  return (
    <Shell me={r.user} unread={r.unread}>
      {children}
    </Shell>
  );
}
