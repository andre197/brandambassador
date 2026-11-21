'use client';

import type { ReactNode } from 'react';
import { LanguageSwitch } from './shell';

export function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[15px] font-semibold tracking-wide text-ink">Brand Ambassador</span>
          <LanguageSwitch />
        </div>
        <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}
