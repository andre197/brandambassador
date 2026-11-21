'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/kit';
import { MerchantForm } from '@/components/parties/party-form';

export default function NewMerchantPage() {
  const t = useTranslations('merchants');
  const router = useRouter();
  return (
    <>
      <PageHeader title={t('new')} />
      <MerchantForm initial={null} onSaved={(id) => router.replace(`/merchants/${id}`)} />
    </>
  );
}
