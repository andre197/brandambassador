'use client';

import { COMMISSION_TYPES, DELIVERY_METHODS, INVOICE_METHODS } from '@ba/shared';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api-client';
import type { Merchant, Producer } from '@/lib/types';
import { Btn, Card, Check, ErrorNote, In, OkNote, Sel, Txt, useAction } from '../kit';

type Form = Record<string, string | boolean>;

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** The fields every party has: name, ЕИК, phone, email, address. */
function CommonFields({ form, set, field }: { form: Form; set(k: string, v: string | boolean): void; field(k: string): string | null }) {
  const t = useTranslations('parties');
  const input = (k: string, label: string, opts: { type?: string; required?: boolean; hint?: string; className?: string } = {}) => (
    <In
      className={opts.className}
      label={label}
      type={opts.type ?? 'text'}
      required={opts.required}
      hint={opts.hint}
      value={str(form[k])}
      onChange={(e) => set(k, e.target.value)}
      error={field(k)}
    />
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {input('name', t('name'), { required: true, className: 'sm:col-span-2' })}
      {input('eik', t('eik'), { required: true, hint: t('eikHint') })}
      {input('contact_person', t('contactPerson'))}
      {input('phone', t('phone'), { required: true, type: 'tel' })}
      {input('email', t('email'), { type: 'email' })}
      <Txt className="sm:col-span-2" label={t('address')} required value={str(form.address)} onChange={(e) => set('address', e.target.value)} error={field('address')} />
    </div>
  );
}

export function ProducerForm({ initial, onSaved }: { initial: Producer | null; onSaved(id: string): void }) {
  const t = useTranslations('parties');
  const tc = useTranslations('common');
  const tdm = useTranslations('deliveryMethods');
  const tim = useTranslations('invoiceMethods');
  const tm = useTranslations('commissionTerms');
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<Form>({
    name: str(initial?.name),
    eik: str(initial?.eik),
    phone: str(initial?.phone),
    email: str(initial?.email),
    address: str(initial?.address),
    contact_person: str(initial?.contact_person),
    notes: str(initial?.notes),
    active: initial?.active ?? true,
    commission_type: initial?.commission_type ?? 'percent',
    commission_percent: initial?.commission_bp !== undefined ? String(initial.commission_bp / 100) : '',
    commission_unit: initial?.commission_unit_cents ? (initial.commission_unit_cents / 100).toFixed(2) : '',
    default_vat_percent: initial ? String(initial.default_vat_bp / 100) : '20',
    delivery_method: initial?.delivery_method ?? 'own_transport',
    delivery_note: str(initial?.delivery_note),
    invoice_method: initial?.invoice_method ?? 'email',
    invoice_note: str(initial?.invoice_note),
    contract_number: str(initial?.contract_number),
    contract_signed_on: str(initial?.contract_signed_on),
  });
  const set = (k: string, v: string | boolean) => {
    setForm({ ...form, [k]: v });
    setSaved(false);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...form, commission_percent: form.commission_percent === '' ? null : form.commission_percent, commission_unit: form.commission_unit === '' ? null : form.commission_unit };
    const r = await action.run(() => api<{ id: string }>(initial ? `/producers/${initial.id}` : '/producers', { method: initial ? 'PUT' : 'POST', body }));
    if (r) {
      setSaved(true);
      onSaved(r.id);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-6">
      <Card title={t('details')}>
        <CommonFields form={form} set={set} field={action.field} />
      </Card>
      <Card title={t('terms')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Sel label={tm('type')} value={str(form.commission_type)} onChange={(e) => set('commission_type', e.target.value)}>
            {COMMISSION_TYPES.map((x) => (
              <option key={x} value={x}>
                {tm(`types.${x}`)}
              </option>
            ))}
          </Sel>
          {form.commission_type === 'per_unit' ? (
            <In label={tm('unitAmount')} inputMode="decimal" value={str(form.commission_unit)} onChange={(e) => set('commission_unit', e.target.value)} error={action.field('commission_unit')} hint={tm('unitHint')} required />
          ) : (
            <In label={t('commissionPercent')} inputMode="decimal" value={str(form.commission_percent)} onChange={(e) => set('commission_percent', e.target.value)} error={action.field('commission_percent')} hint={t('commissionHint')} placeholder="10" />
          )}
          <In label={t('defaultVat')} inputMode="decimal" value={str(form.default_vat_percent)} onChange={(e) => set('default_vat_percent', e.target.value)} error={action.field('default_vat_percent')} />
          <In label={t('contractNumber')} value={str(form.contract_number)} onChange={(e) => set('contract_number', e.target.value)} />
          <In type="date" label={t('contractSignedOn')} value={str(form.contract_signed_on)} onChange={(e) => set('contract_signed_on', e.target.value)} error={action.field('contract_signed_on')} hint={t('contractHint')} />
        </div>
      </Card>
      <Card title={t('logistics')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Sel label={t('deliveryMethod')} value={str(form.delivery_method)} onChange={(e) => set('delivery_method', e.target.value)}>
            {DELIVERY_METHODS.map((m) => (
              <option key={m} value={m}>
                {tdm(m)}
              </option>
            ))}
          </Sel>
          <Sel label={t('invoiceSent')} value={str(form.invoice_method)} onChange={(e) => set('invoice_method', e.target.value)}>
            {INVOICE_METHODS.map((m) => (
              <option key={m} value={m}>
                {tim(m)}
              </option>
            ))}
          </Sel>
          <Txt label={t('deliveryNote')} value={str(form.delivery_note)} onChange={(e) => set('delivery_note', e.target.value)} />
          <Txt label={t('invoiceNote')} value={str(form.invoice_note)} onChange={(e) => set('invoice_note', e.target.value)} />
        </div>
      </Card>
      <Card title={t('internal')}>
        <div className="space-y-4">
          <Txt label={t('notes')} value={str(form.notes)} onChange={(e) => set('notes', e.target.value)} />
          <Check label={t('activeLabel')} checked={Boolean(form.active)} onChange={(e) => set('active', e.target.checked)} />
        </div>
      </Card>
      {saved ? <OkNote>{tc('saved')}</OkNote> : null}
      <ErrorNote>{action.error}</ErrorNote>
      <Btn tone="primary" type="submit" busy={action.busy}>
        {initial ? tc('save') : tc('create')}
      </Btn>
    </form>
  );
}

export function MerchantForm({ initial, onSaved }: { initial: Merchant | null; onSaved(id: string): void }) {
  const t = useTranslations('parties');
  const tc = useTranslations('common');
  const tim = useTranslations('invoiceMethods');
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<Form>({
    name: str(initial?.name),
    eik: str(initial?.eik),
    phone: str(initial?.phone),
    email: str(initial?.email),
    address: str(initial?.address),
    contact_person: str(initial?.contact_person),
    notes: str(initial?.notes),
    active: initial?.active ?? true,
    invoice_method: initial?.invoice_method ?? 'email',
    invoice_email: str(initial?.invoice_email),
    invoice_note: str(initial?.invoice_note),
    delivery_note: str(initial?.delivery_note),
    zero_vat: initial?.zero_vat ?? false,
  });
  const set = (k: string, v: string | boolean) => {
    setForm({ ...form, [k]: v });
    setSaved(false);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await action.run(() => api<{ id: string }>(initial ? `/merchants/${initial.id}` : '/merchants', { method: initial ? 'PUT' : 'POST', body: form }));
    if (r) {
      setSaved(true);
      onSaved(r.id);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-6">
      <Card title={t('details')}>
        <CommonFields form={form} set={set} field={action.field} />
      </Card>
      <Card title={t('invoicing')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Sel label={t('invoiceReceived')} value={str(form.invoice_method)} onChange={(e) => set('invoice_method', e.target.value)}>
            {INVOICE_METHODS.map((m) => (
              <option key={m} value={m}>
                {tim(m)}
              </option>
            ))}
          </Sel>
          <In label={t('invoiceEmail')} type="email" value={str(form.invoice_email)} onChange={(e) => set('invoice_email', e.target.value)} error={action.field('invoice_email')} />
          <Txt label={t('invoiceNote')} value={str(form.invoice_note)} onChange={(e) => set('invoice_note', e.target.value)} />
          <Txt label={t('receivingNote')} value={str(form.delivery_note)} onChange={(e) => set('delivery_note', e.target.value)} />
          <div className="sm:col-span-2">
            <Check label={t('zeroVat')} checked={Boolean(form.zero_vat)} onChange={(e) => set('zero_vat', e.target.checked)} />
            <p className="mt-1 text-[12px] text-neutral-500">{t('zeroVatHint')}</p>
          </div>
        </div>
      </Card>
      <Card title={t('internal')}>
        <div className="space-y-4">
          <Txt label={t('notes')} value={str(form.notes)} onChange={(e) => set('notes', e.target.value)} />
          <Check label={t('activeLabel')} checked={Boolean(form.active)} onChange={(e) => set('active', e.target.checked)} />
        </div>
      </Card>
      {saved ? <OkNote>{tc('saved')}</OkNote> : null}
      <ErrorNote>{action.error}</ErrorNote>
      <Btn tone="primary" type="submit" busy={action.busy}>
        {initial ? tc('save') : tc('create')}
      </Btn>
    </form>
  );
}
