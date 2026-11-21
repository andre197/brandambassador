'use client';

import { DELIVERY_METHODS, INVOICE_METHODS } from '@ba/shared';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Btn, Card, ErrorNote, Facts, In, Loaded, OkNote, PageHeader, Sel, Txt, useAction, useData, useFmt } from '@/components/kit';
import { PasswordCard } from '@/components/password-card';
import { useMe } from '@/components/session';
import { api } from '@/lib/api-client';
import type { Merchant, Producer } from '@/lib/types';

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function ProfileForm({ party }: { party: Producer & Merchant }) {
  const t = useTranslations('profile');
  const tp = useTranslations('parties');
  const tc = useTranslations('common');
  const tdm = useTranslations('deliveryMethods');
  const tim = useTranslations('invoiceMethods');
  const f = useFmt();
  const me = useMe();
  const producer = me.role === 'producer';
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    phone: party.phone,
    address: party.address,
    contact_person: str(party.contact_person),
    delivery_method: str(party.delivery_method),
    delivery_note: str(party.delivery_note),
    invoice_method: party.invoice_method,
    invoice_note: str(party.invoice_note),
    invoice_email: str(party.invoice_email),
    default_vat_percent: producer ? String(party.default_vat_bp / 100) : '',
  });
  const set = (k: keyof typeof form, v: string) => {
    setForm({ ...form, [k]: v });
    setSaved(false);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => api('/profile', { method: 'PUT', body: form }))) setSaved(true);
  };
  return (
    <form onSubmit={submit} className="space-y-6">
      <Card title={t('company')}>
        <Facts
          items={[
            [tp('name'), party.name],
            [tp('eik'), party.eik],
            [tp('email'), party.email],
            ...(producer
              ? ([
                  [tp('commissionPercent'), f.pct(party.commission_bp)],
                  [tp('contractNumber'), party.contract_number],
                  [t('contractTerm'), party.contract ? t('contractLine', { end: f.date(party.contract.end), notice: f.date(party.contract.notice) }) : '-'],
                ] as [string, string][])
              : []),
          ]}
        />
        <p className="mt-3 text-[12px] text-neutral-500">{t('fixedHint')}</p>
      </Card>
      <Card title={t('contact')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <In label={tp('phone')} required value={form.phone} onChange={(e) => set('phone', e.target.value)} error={action.field('phone')} />
          <In label={tp('contactPerson')} value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
          <Txt className="sm:col-span-2" label={tp('address')} required value={form.address} onChange={(e) => set('address', e.target.value)} error={action.field('address')} />
        </div>
      </Card>
      {producer ? (
        <Card title={tp('logistics')}>
          <p className="mb-3 text-[13px] text-neutral-500">{t('producerLogisticsHint')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Sel label={tp('deliveryMethod')} value={form.delivery_method} onChange={(e) => set('delivery_method', e.target.value)}>
              {DELIVERY_METHODS.map((m) => (
                <option key={m} value={m}>
                  {tdm(m)}
                </option>
              ))}
            </Sel>
            <Sel label={tp('invoiceSent')} value={form.invoice_method} onChange={(e) => set('invoice_method', e.target.value)}>
              {INVOICE_METHODS.map((m) => (
                <option key={m} value={m}>
                  {tim(m)}
                </option>
              ))}
            </Sel>
            <Txt label={tp('deliveryNote')} value={form.delivery_note} onChange={(e) => set('delivery_note', e.target.value)} />
            <Txt label={tp('invoiceNote')} value={form.invoice_note} onChange={(e) => set('invoice_note', e.target.value)} />
            <In label={tp('defaultVat')} inputMode="decimal" value={form.default_vat_percent} onChange={(e) => set('default_vat_percent', e.target.value)} error={action.field('default_vat_percent')} />
          </div>
        </Card>
      ) : (
        <Card title={tp('invoicing')}>
          <p className="mb-3 text-[13px] text-neutral-500">{t('merchantInvoiceHint')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Sel label={tp('invoiceReceived')} value={form.invoice_method} onChange={(e) => set('invoice_method', e.target.value)}>
              {INVOICE_METHODS.map((m) => (
                <option key={m} value={m}>
                  {tim(m)}
                </option>
              ))}
            </Sel>
            <In label={tp('invoiceEmail')} type="email" value={form.invoice_email} onChange={(e) => set('invoice_email', e.target.value)} error={action.field('invoice_email')} />
            <Txt label={tp('invoiceNote')} value={form.invoice_note} onChange={(e) => set('invoice_note', e.target.value)} />
            <Txt label={tp('receivingNote')} value={form.delivery_note} onChange={(e) => set('delivery_note', e.target.value)} />
          </div>
        </Card>
      )}
      {saved ? <OkNote>{tc('saved')}</OkNote> : null}
      <ErrorNote>{action.error}</ErrorNote>
      <Btn tone="primary" type="submit" busy={action.busy}>
        {tc('save')}
      </Btn>
    </form>
  );
}

export default function ProfilePage() {
  const t = useTranslations('profile');
  const me = useMe();
  const state = useData<Producer & Merchant>(me.role === 'admin' ? null : '/profile');
  return (
    <>
      <PageHeader title={t('title')}>{me.email}</PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>{me.role === 'admin' ? null : <Loaded state={state}>{(p) => <ProfileForm party={p} />}</Loaded>}</div>
        <PasswordCard />
      </div>
    </>
  );
}
