import '@fontsource/inter/cyrillic-400.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/cyrillic-500.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/cyrillic-600.css';
import '@fontsource/inter/latin-600.css';
import './globals.css';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: { default: 'Brand Ambassador', template: '%s · Brand Ambassador' },
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body className="bg-paper font-sans text-[#1a1a1a] antialiased">
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
