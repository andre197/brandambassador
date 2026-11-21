import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('errors');
  return (
    <main className="grid min-h-dvh place-items-center p-4 text-center">
      <div>
        <p className="text-lg font-semibold">{t('not_found')}</p>
        <Link href="/" className="mt-3 inline-block text-[14px] text-ink underline">
          Brand Ambassador
        </Link>
      </div>
    </main>
  );
}
