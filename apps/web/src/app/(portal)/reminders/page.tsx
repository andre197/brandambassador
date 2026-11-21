'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/kit';
import { RemindersPanel } from '@/components/reminders/reminders-panel';

export default function RemindersPage() {
  const t = useTranslations('reminders');
  return (
    <>
      <PageHeader title={t('title')} />
      <RemindersPanel />
    </>
  );
}
