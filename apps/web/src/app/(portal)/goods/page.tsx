'use client';

import { useTranslations } from 'next-intl';
import { AgreedPrices } from '@/components/goods/agreed-prices';
import { GoodsManager } from '@/components/goods/goods-manager';
import { PageHeader } from '@/components/kit';
import { useMe } from '@/components/session';

export default function GoodsPage() {
  const t = useTranslations('goods');
  const me = useMe();
  return (
    <>
      <PageHeader title={t('title')}>{me.role === 'producer' ? t('producerIntro') : null}</PageHeader>
      <div className="space-y-6">
        <GoodsManager producerId={me.role === 'producer' ? me.producer_id! : undefined} />
        {me.role === 'producer' ? <AgreedPrices producerId={me.producer_id!} /> : null}
      </div>
    </>
  );
}
