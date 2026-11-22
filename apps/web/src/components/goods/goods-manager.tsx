'use client';

import { UNITS } from '@ba/shared';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api-client';
import type { Good, Producer } from '@/lib/types';
import { ActiveBadge } from '../badges';
import { Btn, Card, Check, ConfirmBtn, Empty, ErrorNote, In, InfoNote, Modal, OkNote, Sel, Table, td, tdNum, Txt, useAction, useData, useFmt, useListFilter } from '../kit';
import { NewRequest } from '../requests/new-request';
import { useMe } from '../session';

function GoodEditor({ good, producerId, producers, onDone }: { good: Good | null; producerId?: string; producers?: Producer[]; onDone(): void }) {
  const t = useTranslations('goods');
  const tc = useTranslations('common');
  const tu = useTranslations('units');
  const tm = useTranslations('commissionTerms');
  const me = useMe();
  const admin = me.role === 'admin';
  // A producer cannot change the price of a good linked with merchants: it asks the admin instead.
  const priceLocked = !admin && Boolean(good?.price_linked);
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState(false);
  const f = useFmt();
  const action = useAction();
  const [pid, setPid] = useState(good?.producer_id ?? producerId ?? '');
  const [form, setForm] = useState({
    name_bg: good?.name_bg ?? '',
    name_en: good?.name_en ?? '',
    sku: good?.sku ?? '',
    unit: good?.unit ?? 'pcs',
    price: good ? (good.price_cents / 100).toFixed(2) : '',
    vat_percent: good ? String(good.vat_bp / 100) : String((producers?.find((p) => p.id === pid)?.default_vat_bp ?? 2000) / 100),
    description: good?.description ?? '',
    active: good?.active ?? true,
    commission_unit: good?.commission_unit_cents !== null && good?.commission_unit_cents !== undefined ? (good.commission_unit_cents / 100).toFixed(2) : '',
  });
  const set = (k: keyof typeof form, v: string | boolean) => setForm({ ...form, [k]: v });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // Only the admin sends the good's commission; for a producer it stays as it is.
    const { commission_unit: _commission, ...rest } = form;
    const body = admin ? form : rest;
    const r = await action.run(() => (good ? api(`/goods/${good.id}`, { method: 'PUT', body }) : api(`/goods${pid ? `?producer_id=${pid}` : ''}`, { method: 'POST', body })));
    if (r) onDone();
  };
  return (
    <>
    <form onSubmit={submit} className="space-y-4">
      {producers && !good ? (
        <Sel label={t('producer')} value={pid} onChange={(e) => setPid(e.target.value)} required error={action.field('producer_id')}>
          <option value="">{tc('choose')}</option>
          {producers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Sel>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <In label={t('nameBg')} required value={form.name_bg} onChange={(e) => set('name_bg', e.target.value)} error={action.field('name_bg')} />
        <In label={t('nameEn')} value={form.name_en} onChange={(e) => set('name_en', e.target.value)} hint={t('nameEnHint')} />
        <In label={t('sku')} value={form.sku} onChange={(e) => set('sku', e.target.value)} />
        <Sel label={t('unit')} value={form.unit} onChange={(e) => set('unit', e.target.value)}>
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {tu(u)}
            </option>
          ))}
        </Sel>
        <In
          label={t('price')}
          inputMode="decimal"
          required
          value={form.price}
          onChange={(e) => set('price', e.target.value)}
          error={action.field('price')}
          hint={priceLocked ? t('priceLockedHint') : t('priceHint')}
          disabled={priceLocked}
        />
        <In label={t('vat')} inputMode="decimal" value={form.vat_percent} onChange={(e) => set('vat_percent', e.target.value)} error={action.field('vat_percent')} />
        {admin ? (
          <In label={tm('goodUnitAmount')} inputMode="decimal" value={form.commission_unit} onChange={(e) => set('commission_unit', e.target.value)} error={action.field('commission_unit')} hint={tm('goodUnitHint')} />
        ) : null}
      </div>
      <Txt label={t('description')} value={form.description} onChange={(e) => set('description', e.target.value)} />
      <Check label={t('activeLabel')} checked={form.active} onChange={(e) => set('active', e.target.checked)} />
      {good && good.merchants_count ? <InfoNote>{t('lockedNote', { count: good.merchants_count })}</InfoNote> : null}
      {priceLocked && good ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-[13px]">
          <span className="flex-1">
            {good.pending_price_cents !== null && good.pending_price_cents !== undefined ? t('pendingPrice', { price: f.money(good.pending_price_cents) }) : asked ? t('requestSent') : t('askPriceHint')}
          </span>
          {good.pending_price_cents === null || good.pending_price_cents === undefined ? (
            asked ? null : (
              <Btn size="sm" onClick={() => setAsking(true)}>
                {t('askPrice')}
              </Btn>
            )
          ) : null}
        </div>
      ) : null}
      <ErrorNote>{action.error}</ErrorNote>
      <Btn tone="primary" type="submit" busy={action.busy}>
        {good ? tc('save') : tc('create')}
      </Btn>
    </form>
      {good ? (
        <Modal title={t('askPrice')} open={asking} onClose={() => setAsking(false)}>
          {asking ? (
            <NewRequest
              good={good}
              onDone={() => {
                setAsking(false);
                setAsked(true);
              }}
            />
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}

/** Goods of one producer (or of all, for the admin): add, change, delete. */
export function GoodsManager({ producerId }: { producerId?: string }) {
  const t = useTranslations('goods');
  const tm = useTranslations('commissionTerms');
  const tc = useTranslations('common');
  const f = useFmt();
  const me = useMe();
  const allProducers = me.role === 'admin' && !producerId;
  const state = useData<Good[]>(`/goods${producerId ? `?producer_id=${producerId}` : ''}`);
  const producers = useData<Producer[]>(allProducers ? '/producers' : null);
  const remove = useAction();
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<Good | 'new' | null>(null);
  const list = useListFilter(state.data, (g) => `${g.name_bg} ${g.name_en ?? ''} ${g.sku ?? ''} ${g.producer_name ?? ''}`, 50);

  return (
    <Card
      title={t('title')}
      actions={
        <Btn size="sm" tone="primary" onClick={() => setEditing('new')}>
          + {t('new')}
        </Btn>
      }
    >
      <In className="mb-3 max-w-sm" placeholder={tc('search')} value={list.q} onChange={(e) => list.setQ(e.target.value)} />
      {state.error ? (
        <ErrorNote>{state.error}</ErrorNote>
      ) : list.rows.length ? (
        <Table head={[t('name'), ...(allProducers ? [t('producer')] : []), t('unit'), t('price'), t('vat'), t('priceGross'), tm('goodColumn'), t('merchants'), t('sold'), '', tc('actions')]}>
          {list.rows.map((g) => (
            <tr key={g.id}>
              <td className={td}>
                <div className="font-medium">{g.name_bg}</div>
                {g.name_en ? <div className="text-[12px] text-neutral-500">{g.name_en}</div> : null}
                {g.sku ? <div className="text-[12px] text-neutral-500">{g.sku}</div> : null}
              </td>
              {allProducers ? <td className={td}>{g.producer_name}</td> : null}
              <td className={td}>{f.unit(g.unit)}</td>
              <td className={tdNum}>{f.money(g.price_cents)}</td>
              <td className={tdNum}>{f.pct(g.vat_bp)}</td>
              <td className={tdNum}>{f.money(g.price_gross_cents)}</td>
              <td className={tdNum}>{g.commission_unit_cents !== null && g.commission_unit_cents !== undefined ? `${f.money(g.commission_unit_cents)} / ${f.unit(g.unit)}` : <span className="text-neutral-500">{tm('fromProducer')}</span>}</td>
              <td className={tdNum}>{g.merchants_count ?? 0}</td>
              <td className={tdNum}>{f.qty(g.sold_milli ?? 0)}</td>
              <td className={td}>
                <ActiveBadge active={g.active} />
              </td>
              <td className={td}>
                <div className="flex gap-2">
                  <Btn size="sm" onClick={() => setEditing(g)}>
                    {tc('edit')}
                  </Btn>
                  <ConfirmBtn
                    busy={remove.busy}
                    onConfirm={async () => {
                      const r = await remove.run(() => api<{ archived: boolean }>(`/goods/${g.id}`, { method: 'DELETE' }));
                      if (r) {
                        setNote(r.archived ? t('archived') : t('deleted'));
                        void state.reload();
                      }
                    }}
                  >
                    {tc('delete')}
                  </ConfirmBtn>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      ) : state.data ? (
        <Empty />
      ) : null}
      <div className="mt-3 space-y-2">
        <OkNote>{note}</OkNote>
        <ErrorNote>{remove.error}</ErrorNote>
        <p className="text-[12px] text-neutral-500">{t('priceRule')}</p>
      </div>
      <Modal title={editing === 'new' ? t('new') : t('edit')} open={editing !== null} onClose={() => setEditing(null)} wide>
        {editing !== null ? (
          <GoodEditor
            good={editing === 'new' ? null : editing}
            producerId={producerId}
            producers={allProducers ? (producers.data ?? []) : undefined}
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
