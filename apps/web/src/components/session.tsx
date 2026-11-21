'use client';

import { createContext, type ReactNode, useContext } from 'react';
import type { Me } from '@/lib/types';

const SessionContext = createContext<Me | null>(null);

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}

/** The signed-in user (pages under the portal layout always have one). */
export function useMe(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error('useMe outside the portal');
  return me;
}
