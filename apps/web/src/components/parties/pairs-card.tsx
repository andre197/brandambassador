'use client';

import { PAIR_STATUSES, releaseFeeCents } from '@ba/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api-client';
import type { Merchant, Pair } from '@/lib/types';
import { Badge, Btn, Card, ConfirmBtn, Empty, ErrorNote, In, InfoNote, Modal, Sel, Table, td, tdNum, Txt, useAction, useData, useFmt } from '../kit';
import { useMe } from '../session';

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function PairEditor({ producerId, pair, merchants, onDone, onClose }: { producerId: string; pair: Pair | null; merchants: Merchant[]; onDone(): void; onClose(): void }) {
  const t = useTranslations('pairs');
  const tc = useTranslations('common');
  const tp = useTranslations('pairStatus');
  const f = useFmt();
  const action = useAction();
  const [form, setForm] = useState({
    merchant_id: pair?.merchant_id ?? '',
    status: pair?.status ?? 'attracted',
    commission_percent: pair?.commission_bp !== null && pair?.commission_bp !== undefined ? String(pair.commission_bp / 100) : '',
    introduced_on: str(pair?.introduced_on),
    introduced_how: str(pair?.introduced_how),
    territory: str(pair?.territory),
    products_note: str(pair?.products_note),
    active_period_days: String(pair?.active_period_days ?? 30),
    released_on: str(pair?.released_on),
    release_fee: pair?.release_fee_cents !== null && pair?.release_fee_cents !== undefined ? (pair.release_fee_cents / 100).toFixed(2) : '',
    special_terms: str(pair?.special_terms),
  });
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...form, commission_percent: form.commission_percent === '' ? null : form.commission_percent, release_fee: form.release_fee === '' ? null : form.release_fee };
    if (await action.run(() => api(`/producers/${producerId}/pairs`, { method: 'PUT', body }))) onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Sel label={t('merchant')} value={form.merchant_id} onChange={(e) => set('merchant_id', e.target.value)} disabled={Boolean(pair)} required error={action.field('merchant_id')}>
        <option value="">{tc('choose')}</option>
        {merchants.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ({m.eik})
          </option>
        ))}
      </Sel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Sel label={t('status')} value={form.status} onChange={(e) => set('status', e.target.value)}>
          {PAIR_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tp(s)}
            </option>
          ))}
        </Sel>
        <In label={t('commission')} inputMode="decimal" value={form.commission_percent} onChange={(e) => set('commission_percent', e.target.value)} hint={t('commissionHint')} error={action.field('commission_percent')} />
        <In type="date" label={t('introducedOn')} value={form.introduced_on} onChange={(e) => set('introduced_on', e.target.value)} />
        <In label={t('introducedHow')} value={form.introduced_how} onChange={(e) => set('introduced_how', e.target.value)} />
        <In label={t('territory')} value={form.territory} onChange={(e) => set('territory', e.target.value)} />
        <In label={t('activePeriod')} inputMode="numeric" value={form.active_period_days} onChange={(e) => set('active_period_days', e.target.value)} hint={t('activePeriodHint')} error={action.field('active_period_days')} />
      </div>
      <Txt label={t('products')} value={form.products_note} onChange={(e) => set('products_note', e.target.value)} />
      {form.status === 'released' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <In type="date" label={t('releasedOn')} value={form.released_on} onChange={(e) => set('released_on', e.target.value)} />
          <In
            label={t('releaseFee')}
            inputMode="decimal"
            value={form.release_fee}
            onChange={(e) => set('release_fee', e.target.value)}
            hint={pair ? t('releaseFeeHint', { amount: f.money(releaseFeeCents(pair.first_net_cents ?? 0)) }) : undefined}
          />
        </div>
      ) : null}
      <Txt label={t('specialTerms')} value={form.special_terms} onChange={(e) => set('special_terms', e.target.value)} />
      <InfoNote>{t('statusHint')}</InfoNote>
      <ErrorNote>{action.error}</ErrorNote>
      <div className="flex gap-2">
        <Btn tone="primary" type="submit" busy={action.busy}>
          {tc('save')}
        </Btn>
        <Btn onClick={onClose}>{tc('cancel')}</Btn>
      </div>
    </form>
  );
}

/** Приложение № 1: the buyers I brought to a producer, with their special terms. */
export function PairsCard({ producerId }: { producerId: string }) {
  const t = useTranslations('pairs');
  const tc = useTranslations('common');
  const tp = useTranslations('pairStatus');
  const f = useFmt();
  const me = useMe();
  const admin = me.role === 'admin';
  const state = useData<Pair[]>(`/producers/${producerId}/pairs`);
  const merchants = useData<Merchant[]>(admin ? '/merchants' : null);
  const remove = useAction();
  const [editing, setEditing] = useState<Pair | 'new' | null>(null);

  return (
    <Card
      title={t('title')}
      actions={
        admin ? (
          <Btn size="sm" tone="primary" onClick={() => setEditing('new')}>
            + {t('add')}
          </Btn>
        ) : null
      }
    >
      <p className="mb-3 text-[13px] text-neutral-500">{t('hint')}</p>
      {state.data?.length ? (
        <Table head={[t('merchant'), t('status'), t('commission'), t('orders'), t('total'), t('lastOrder'), t('active'), ...(admin ? [tc('actions')] : [])]}>
          {state.data.map((p) => (
            <tr key={p.id}>
              <td className={td}>
                {admin ? (
                  <Link href={`/merchants/${p.merchant_id}`} className="font-medium text-ink hover:underline">
                    {p.merchant_name}
                  </Link>
                ) : (
                  <span className="font-medium">{p.merchant_name}</span>
                )}
                {p.territory ? <div className="text-[12px] text-neutral-500">{p.territory}</div> : null}
              </td>
              <td className={td}>
                <Badge tone={p.status === 'attracted' ? 'blue' : 'gray'}>{tp(p.status)}</Badge>
              </td>
              <td className={tdNum}>
                {f.pct(p.effective_commission_bp)}
                {p.commission_bp !== null && p.status === 'attracted' ? <div className="text-[11px] text-gold">{t('individual')}</div> : null}
              </td>
              <td className={tdNum}>{p.orders}</td>
              <td className={tdNum}>{f.money(p.total_net_cents)}</td>
              <td className={`${td} whitespace-nowrap`}>{f.date(p.last_order_on)}</td>
              <td className={td}>{p.active_buyer ? <Badge tone="green">{t('activeYes')}</Badge> : <Badge>{t('activeNo')}</Badge>}</td>
              {admin ? (
                <td className={td}>
                  <div className="flex gap-2">
                    <Btn size="sm" onClick={() => setEditing(p)}>
                      {tc('edit')}
                    </Btn>
                    {p.orders === 0 ? (
                      <ConfirmBtn
                        onConfirm={async () => {
                          if (await remove.run(() => api(`/producers/${producerId}/pairs/${p.merchant_id}`, { method: 'DELETE' }))) void state.reload();
                        }}
                      >
                        {tc('delete')}
                      </ConfirmBtn>
                    ) : null}
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      ) : state.data ? (
        <Empty />
      ) : null}
      <ErrorNote>{remove.error}</ErrorNote>
      <Modal title={editing === 'new' ? t('add') : t('edit')} open={editing !== null} onClose={() => setEditing(null)} wide>
        {editing !== null ? (
          <PairEditor
            producerId={producerId}
            pair={editing === 'new' ? null : editing}
            merchants={(merchants.data ?? []).filter((m) => editing !== 'new' || !state.data?.some((p) => p.merchant_id === m.id))}
            onClose={() => setEditing(null)}
            onDone={() => {
              setEditing(null);
              void state.reload();
            }}
          />
        ) : null}
      </Modal>
    </Card>
  );
}
