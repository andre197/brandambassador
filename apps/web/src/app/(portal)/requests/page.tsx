'use client';

import { REQUEST_STATUSES } from '@ba/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { RequestBadge } from '@/components/badges';
import { Btn, Check, Empty, ErrorNote, In, InfoNote, Loaded, Modal, PageHeader, Sel, Table, td, tdNum, Txt, useAction, useData, useFmt } from '@/components/kit';
import { useMe } from '@/components/session';
import { api } from '@/lib/api-client';
import type { Good, Merchant, PriceRequest, Producer } from '@/lib/types';

function Resolve({ r, onDone }: { r: PriceRequest; onDone(): void }) {
  const t = useTranslations('requests');
  const f = useFmt();
  const action = useAction();
  const [price, setPrice] = useState(((r.proposed_price_cents ?? r.current_price_cents) / 100).toFixed(2));
  const [apply, setApply] = useState(true);
  const [response, setResponse] = useState('');
  const go = async (decision: 'approved' | 'rejected') => {
    if (await action.run(() => api(`/requests/${r.id}/resolve`, { method: 'POST', body: { decision, new_price: decision === 'approved' ? price : null, apply_to_open_orders: apply, response } }))) onDone();
  };
  return (
    <div className="space-y-4">
      <p className="text-[14px]">
        {r.producer_name} → {r.merchant_name} · <strong>{r.good_name}</strong>
      </p>
      <p className="text-[14px] text-neutral-600">
        {t('currentPrice', { price: f.money(r.current_price_cents) })}
        {r.proposed_price_cents !== null ? ` · ${t('proposedPrice', { price: f.money(r.proposed_price_cents) })}` : ''}
      </p>
      {r.description ? <p className="rounded-md bg-neutral-50 p-3 text-[14px]">„{r.description}“</p> : null}
      <In label={t('newPrice')} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} error={action.field('new_price')} />
      <Check label={t('applyOpen')} checked={apply} onChange={(e) => setApply(e.target.checked)} />
      <Txt label={t('response')} value={response} onChange={(e) => setResponse(e.target.value)} />
      <ErrorNote>{action.error}</ErrorNote>
      <div className="flex gap-2">
        <Btn tone="primary" busy={action.busy} onClick={() => void go('approved')}>
          {t('approve')}
        </Btn>
        <Btn tone="danger" busy={action.busy} onClick={() => void go('rejected')}>
          {t('reject')}
        </Btn>
      </div>
    </div>
  );
}

function NewRequest({ onDone }: { onDone(): void }) {
  const t = useTranslations('requests');
  const tc = useTranslations('common');
  const me = useMe();
  const f = useFmt();
  const action = useAction();
  const [producerId, setProducerId] = useState(me.producer_id ?? '');
  const [merchantId, setMerchantId] = useState('');
  const [goodId, setGoodId] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const producers = useData<Producer[]>(me.role === 'merchant' ? '/producers' : null);
  const merchants = useData<Merchant[]>(me.role === 'producer' ? '/merchants' : null);
  const goods = useData<Good[]>(producerId ? `/goods?producer_id=${producerId}` : null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => api('/requests', { method: 'POST', body: { good_id: goodId, merchant_id: me.role === 'producer' ? merchantId : undefined, proposed_price: price || null, description } }))) onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {me.role === 'merchant' ? (
        <Sel label={t('producer')} required value={producerId} onChange={(e) => setProducerId(e.target.value)}>
          <option value="">{tc('choose')}</option>
          {(producers.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Sel>
      ) : (
        <Sel label={t('merchant')} required value={merchantId} onChange={(e) => setMerchantId(e.target.value)} error={action.field('merchant_id')}>
          <option value="">{tc('choose')}</option>
          {(merchants.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Sel>
      )}
      <Sel label={t('good')} required value={goodId} onChange={(e) => setGoodId(e.target.value)} error={action.field('good_id')}>
        <option value="">{tc('choose')}</option>
        {(goods.data ?? []).map((g) => (
          <option key={g.id} value={g.id}>
            {g.name_bg} ({f.money(g.my_price_cents ?? g.price_cents)})
          </option>
        ))}
      </Sel>
      <In label={t('proposed')} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} error={action.field('proposed_price')} hint={t('proposedHint')} />
      <Txt label={t('description')} value={description} onChange={(e) => setDescription(e.target.value)} />
      <InfoNote>{t('onlyAdminHint')}</InfoNote>
      <ErrorNote>{action.error}</ErrorNote>
      <Btn tone="primary" type="submit" busy={action.busy}>
        {t('send')}
      </Btn>
    </form>
  );
}

export default function RequestsPage() {
  const t = useTranslations('requests');
  const ts = useTranslations('requestStatus');
  const tr = useTranslations('roles');
  const f = useFmt();
  const me = useMe();
  const [status, setStatus] = useState('');
  const state = useData<PriceRequest[]>(`/requests${status ? `?status=${status}` : ''}`);
  const [resolving, setResolving] = useState<PriceRequest | null>(null);
  const [creating, setCreating] = useState(false);
  const admin = me.role === 'admin';

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          !admin ? (
            <Btn tone="primary" onClick={() => setCreating(true)}>
              + {t('new')}
            </Btn>
          ) : null
        }
      >
        {admin ? t('adminIntro') : t('intro')}
      </PageHeader>
      <Sel className="mb-4 max-w-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">{t('allStatuses')}</option>
        {REQUEST_STATUSES.map((s) => (
          <option key={s} value={s}>
            {ts(s)}
          </option>
        ))}
      </Sel>
      <Loaded state={state}>
        {(rows) =>
          rows.length ? (
            <Table head={['№', t('date'), t('good'), ...(me.role !== 'producer' ? [t('producer')] : []), ...(me.role !== 'merchant' ? [t('merchant')] : []), t('current'), t('proposedCol'), t('newPrice'), t('from'), t('status'), '']}>
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className={td}>
                    {r.number}
                    {r.order_id ? (
                      <div>
                        <Link href={`/orders/${r.order_id}`} className="text-[12px] text-ink hover:underline">
                          №{r.order_number}
                        </Link>
                      </div>
                    ) : null}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{f.date(r.created_at)}</td>
                  <td className={td}>
                    <div className="font-medium">{r.good_name}</div>
                    {r.description ? <div className="max-w-xs text-[12px] text-neutral-600">„{r.description}“</div> : null}
                    {r.response ? <div className="max-w-xs text-[12px] text-blue-800">{t('reply')}: {r.response}</div> : null}
                  </td>
                  {me.role !== 'producer' ? <td className={td}>{r.producer_name}</td> : null}
                  {me.role !== 'merchant' ? <td className={td}>{r.merchant_name}</td> : null}
                  <td className={tdNum}>{f.money(r.current_price_cents)}</td>
                  <td className={tdNum}>{f.money(r.proposed_price_cents)}</td>
                  <td className={tdNum}>{f.money(r.new_price_cents)}</td>
                  <td className={td}>{tr(r.requested_by_role)}</td>
                  <td className={td}>
                    <RequestBadge status={r.status} />
                  </td>
                  <td className={td}>
                    {admin && r.status === 'pending' ? (
                      <Btn size="sm" tone="primary" onClick={() => setResolving(r)}>
                        {t('resolve')}
                      </Btn>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty />
          )
        }
      </Loaded>
      <Modal title={resolving ? t('resolveTitle', { number: resolving.number }) : ''} open={resolving !== null} onClose={() => setResolving(null)}>
        {resolving ? (
          <Resolve
            r={resolving}
            onDone={() => {
              setResolving(null);
              void state.reload();
            }}
          />
        ) : null}
      </Modal>
      <Modal title={t('new')} open={creating} onClose={() => setCreating(false)}>
        {creating ? (
          <NewRequest
            onDone={() => {
              setCreating(false);
              void state.reload();
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}
