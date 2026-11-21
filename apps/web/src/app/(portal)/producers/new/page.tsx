'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/kit';
import { ProducerForm } from '@/components/parties/party-form';

export default function NewProducerPage() {
  const t = useTranslations('producers');
  const router = useRouter();
  return (
    <>
      <PageHeader title={t('new')} />
      <ProducerForm initial={null} onSaved={(id) => router.replace(`/producers/${id}`)} />
    </>
  );
}
