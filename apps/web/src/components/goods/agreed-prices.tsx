'use client';

import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api-client';
import type { AgreedPrice } from '@/lib/types';
import { Btn, Card, Check, Empty, ErrorNote, In, Modal, Table, td, tdNum, Txt, useAction, useData, useFmt } from '../kit';
import { useMe } from '../session';

function PriceEditor({ row, onDone }: { row: AgreedPrice; onDone(): void }) {
  const t = useTranslations('prices');
  const tc = useTranslations('common');
  const action = useAction();
  const [price, setPrice] = useState((row.price_cents / 100).toFixed(2));
  const [apply, setApply] = useState(true);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => api(`/agreed-prices/${row.good_id}/${row.merchant_id}`, { method: 'PUT', body: { price, apply_to_open_orders: apply } }))) onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <In label={t('price')} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} error={action.field('price')} />
      <Check label={t('applyOpen')} checked={apply} onChange={(e) => setApply(e.target.checked)} />
      <ErrorNote>{action.error}</ErrorNote>
      <Btn tone="primary" type="submit" busy={action.busy}>
        {tc('save')}
      </Btn>
    </form>
  );
}

function AskEditor({ row, onDone }: { row: AgreedPrice; onDone(): void }) {
  const t = useTranslations('requests');
  const action = useAction();
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => api('/requests', { method: 'POST', body: { good_id: row.good_id, merchant_id: row.merchant_id, proposed_price: price || null, description } }))) onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <In label={t('proposed')} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} error={action.field('proposed_price')} hint={t('proposedHint')} />
      <Txt label={t('description')} value={description} onChange={(e) => setDescription(e.target.value)} />
      <ErrorNote>{action.error}</ErrorNote>
      <Btn tone="primary" type="submit" busy={action.busy}>
        {t('send')}
      </Btn>
    </form>
  );
}

/** Prices locked per merchant. Only the admin changes them; producers and merchants ask. */
export function AgreedPrices({ producerId, merchantId }: { producerId?: string; merchantId?: string }) {
  const t = useTranslations('prices');
  const tr = useTranslations('requests');
  const locale = useLocale();
  const f = useFmt();
  const me = useMe();
  const q = new URLSearchParams();
  if (producerId) q.set('producer_id', producerId);
  if (merchantId) q.set('merchant_id', merchantId);
  const state = useData<AgreedPrice[]>(`/agreed-prices?${q.toString()}`);
  const [editing, setEditing] = useState<AgreedPrice | null>(null);
  const [sent, setSent] = useState(false);
  const admin = me.role === 'admin';
  // The merchant sees only its agreed prices, not the producer's current (wanted) price.
  const showWanted = me.role !== 'merchant';

  return (
    <Card title={t('title')}>
      <p className="mb-3 text-[13px] text-neutral-500">{me.role === 'merchant' ? t('merchantHint') : t('hint')}</p>
      {state.data?.length ? (
        <Table head={[...(merchantId ? [] : [t('merchant')]), ...(producerId ? [] : [t('producer')]), t('good'), t('price'), t('priceGross'), ...(showWanted ? [t('listPrice'), t('listPriceGross')] : []), t('quantity'), t('lastOrder'), '']}>
          {state.data.map((r) => (
            <tr key={r.id}>
              {merchantId ? null : <td className={td}>{r.merchant_name}</td>}
              {producerId ? null : <td className={td}>{r.producer_name}</td>}
              <td className={td}>{locale === 'en' && r.name_en ? r.name_en : r.name_bg}</td>
              <td className={`${tdNum} font-medium`}>
                {f.money(r.price_cents)} / {f.unit(r.unit)}
              </td>
              <td className={tdNum}>{f.money(r.price_gross_cents)}</td>
              {showWanted ? (
                <>
                  <td className={`${tdNum} text-neutral-500`}>{f.money(r.list_price_cents)}</td>
                  <td className={`${tdNum} text-neutral-500`}>{f.money(r.list_price_gross_cents)}</td>
                </>
              ) : null}
              <td className={tdNum}>{f.qty(r.quantity_milli, r.unit)}</td>
              <td className={`${td} whitespace-nowrap`}>{f.date(r.last_order_on)}</td>
              <td className={`${td} text-right`}>
                <Btn size="sm" onClick={() => setEditing(r)}>
                  {admin ? t('change') : tr('askShort')}
                </Btn>
              </td>
            </tr>
          ))}
        </Table>
      ) : state.data ? (
        <Empty />
      ) : null}
      {sent ? <p className="mt-2 text-[13px] text-green-700">{tr('sent')}</p> : null}
      <Modal title={editing ? `${editing.name_bg} · ${editing.merchant_name}` : ''} open={editing !== null} onClose={() => setEditing(null)}>
        {editing ? (
          admin ? (
            <PriceEditor
              row={editing}
              onDone={() => {
                setEditing(null);
                void state.reload();
              }}
            />
          ) : (
            <AskEditor
              row={editing}
              onDone={() => {
                setEditing(null);
                setSent(true);
              }}
            />
          )
        ) : null}
      </Modal>
    </Card>
  );
}
