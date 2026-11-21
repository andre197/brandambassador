import type messages from './messages/bg.json';

declare module 'next-intl' {
  interface AppConfig {
    Locale: 'bg' | 'en';
    Messages: typeof messages;
  }
}
