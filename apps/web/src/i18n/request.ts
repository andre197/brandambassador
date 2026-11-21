import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export const LOCALE_COOKIE = 'locale';
export const LOCALES = ['bg', 'en'] as const;

/** The language comes from the `locale` cookie (set at sign-in and by the switcher); Bulgarian by default. */
export default getRequestConfig(async () => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = fromCookie === 'en' ? 'en' : 'bg';
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: 'Europe/Sofia',
  };
});
