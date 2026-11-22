'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api-client';
import type { Good, Merchant, Producer } from '@/lib/types';
import { Btn, ErrorNote, In, InfoNote, Sel, Txt, useAction, useData, useFmt } from '../kit';
import { useMe } from '../session';

/**
 * A price change request. A merchant asks about its own price. A producer asks either for the good's
 * own price (no merchant: for merchants that have not ordered it; agreed prices and orders stay) or for
 * one merchant's agreed price. `good` opens it for one good, asking for the good's own price.
 */
export function NewRequest({ onDone, good }: { onDone(): void; good?: Good }) {
  const t = useTranslations('requests');
  const tc = useTranslations('common');
  const me = useMe();
  const f = useFmt();
  const action = useAction();
  const [producerId, setProducerId] = useState(good?.producer_id ?? me.producer_id ?? '');
  // '' (producer): the good's own price.
  const [merchantId, setMerchantId] = useState('');
  const [goodId, setGoodId] = useState(good?.id ?? '');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const producers = useData<Producer[]>(me.role === 'merchant' ? '/producers' : null);
  const merchants = useData<Merchant[]>(me.role === 'producer' && !good ? '/merchants' : null);
  const goods = useData<Good[]>(producerId && !good ? `/goods?producer_id=${producerId}` : null);
  const listPrice = me.role === 'producer' && !merchantId;
  const chosen = good ?? goods.data?.find((g) => g.id === goodId);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      await action.run(() =>
        api('/requests', { method: 'POST', body: { good_id: goodId, merchant_id: me.role === 'producer' && merchantId ? merchantId : undefined, proposed_price: price || null, description } }),
      )
    )
      onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {good ? (
        <p className="text-[14px]">
          <strong>{good.name_bg}</strong> · {t('currentPrice', { price: f.money(good.price_cents) })}
        </p>
      ) : me.role === 'merchant' ? (
        <Sel label={t('producer')} required value={producerId} onChange={(e) => setProducerId(e.target.value)}>
          <option value="">{tc('choose')}</option>
          {(producers.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Sel>
      ) : (
        <Sel label={t('target')} value={merchantId} onChange={(e) => setMerchantId(e.target.value)} error={action.field('merchant_id')}>
          <option value="">{t('targetList')}</option>
          {(merchants.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {t('targetMerchant', { merchant: m.name })}
            </option>
          ))}
        </Sel>
      )}
      {good ? null : (
        <Sel label={t('good')} required value={goodId} onChange={(e) => setGoodId(e.target.value)} error={action.field('good_id')}>
          <option value="">{tc('choose')}</option>
          {(goods.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name_bg} ({f.money(listPrice ? g.price_cents : (g.my_price_cents ?? g.price_cents))})
            </option>
          ))}
        </Sel>
      )}
      <In
        label={t('proposed')}
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        error={action.field('proposed_price')}
        hint={listPrice ? undefined : t('proposedHint')}
        required={listPrice}
      />
      <Txt label={t('description')} value={description} onChange={(e) => setDescription(e.target.value)} />
      <InfoNote>{listPrice ? t('listPriceHint') : t('onlyAdminHint')}</InfoNote>
      <ErrorNote>{action.error}</ErrorNote>
      <Btn tone="primary" type="submit" busy={action.busy} disabled={!chosen && !goodId}>
        {t('send')}
      </Btn>
    </form>
  );
}
