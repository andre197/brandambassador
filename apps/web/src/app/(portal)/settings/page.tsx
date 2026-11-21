'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useState } from 'react';
import { Btn, Card, ErrorNote, In, Loading, OkNote, PageHeader, useAction } from '@/components/kit';
import { UsersCard } from '@/components/parties/users-card';
import { PasswordCard } from '@/components/password-card';
import { api } from '@/lib/api-client';

interface Settings {
  default_commission_bp: number;
  reminder_days_before: number;
  notify_emails: string[];
  company_name: string | null;
  company_eik: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
}

export default function SettingsPage() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const action = useAction();
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void action.run(async () => {
      const s = await api<Settings>('/settings');
      setForm({
        default_commission_percent: String(s.default_commission_bp / 100),
        reminder_days_before: String(s.reminder_days_before),
        notify_emails: s.notify_emails.join(', '),
        company_name: s.company_name ?? '',
        company_eik: s.company_eik ?? '',
        company_address: s.company_address ?? '',
        company_phone: s.company_phone ?? '',
        company_email: s.company_email ?? '',
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!form) return action.error ? <ErrorNote>{action.error}</ErrorNote> : <Loading />;

  const field = (k: string, label: string, hint?: string) => (
    <In
      label={label}
      hint={hint}
      value={form[k] ?? ''}
      onChange={(e) => {
        setForm({ ...form, [k]: e.target.value });
        setSaved(false);
      }}
      error={action.field(k)}
    />
  );
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => api('/settings', { method: 'PUT', body: form }))) setSaved(true);
  };

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <form onSubmit={save} className="space-y-6">
            <Card title={t('commission')}>
              <div className="grid gap-4 sm:grid-cols-2">
                {field('default_commission_percent', t('defaultCommission'), t('defaultCommissionHint'))}
                {field('reminder_days_before', t('reminderDays'), t('reminderDaysHint'))}
              </div>
            </Card>
            <Card title={t('notifications')}>{field('notify_emails', t('notifyEmails'), t('notifyEmailsHint'))}</Card>
            <Card title={t('company')}>
              <div className="grid gap-4 sm:grid-cols-2">
                {field('company_name', t('companyName'))}
                {field('company_eik', t('companyEik'))}
                {field('company_phone', t('companyPhone'))}
                {field('company_email', t('companyEmail'))}
                <div className="sm:col-span-2">{field('company_address', t('companyAddress'))}</div>
              </div>
            </Card>
            {saved ? <OkNote>{tc('saved')}</OkNote> : null}
            <ErrorNote>{action.error}</ErrorNote>
            <Btn tone="primary" type="submit" busy={action.busy}>
              {tc('save')}
            </Btn>
          </form>
          <UsersCard />
        </div>
        <PasswordCard />
      </div>
    </>
  );
}
