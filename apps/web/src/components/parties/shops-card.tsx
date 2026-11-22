'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api-client';
import type { Shop } from '@/lib/types';
import { ActiveBadge } from '../badges';
import { Btn, Card, Check, ConfirmBtn, Empty, ErrorNote, In, Loaded, Modal, Table, td, tdNum, useAction, useData } from '../kit';
import { useMe } from '../session';

function ShopEditor({ merchantId, shop, onDone }: { merchantId: string; shop: Shop | null; onDone(): void }) {
  const t = useTranslations('shops');
  const tc = useTranslations('common');
  const action = useAction();
  const [form, setForm] = useState({ alias: shop?.alias ?? '', address: shop?.address ?? '', active: shop?.active ?? true });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const url = shop ? `/merchants/${merchantId}/shops/${shop.id}` : `/merchants/${merchantId}/shops`;
    if (await action.run(() => api(url, { method: shop ? 'PUT' : 'POST', body: form }))) onDone();
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <In label={t('alias')} value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} error={action.field('alias')} hint={t('aliasHint')} required />
      <In label={t('address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} error={action.field('address')} required />
      <Check label={t('activeLabel')} checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
      <ErrorNote>{action.error}</ErrorNote>
      <Btn tone="primary" type="submit" busy={action.busy}>
        {tc('save')}
      </Btn>
    </form>
  );
}

/** The shops of a merchant (one company, several addresses). The admin manages them. */
export function ShopsCard({ merchantId }: { merchantId: string }) {
  const t = useTranslations('shops');
  const tc = useTranslations('common');
  const me = useMe();
  const admin = me.role === 'admin';
  const state = useData<Shop[]>(`/merchants/${merchantId}/shops`);
  const remove = useAction();
  const [editing, setEditing] = useState<Shop | 'new' | null>(null);
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
      <Loaded state={state}>
        {(rows) =>
          rows.length ? (
            <Table head={[t('alias'), t('address'), ...(admin ? [t('orders'), '', tc('actions')] : [])]}>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className={`${td} font-medium`}>{s.alias}</td>
                  <td className={td}>{s.address}</td>
                  {admin ? (
                    <>
                      <td className={tdNum}>{s.orders ?? 0}</td>
                      <td className={td}>
                        <ActiveBadge active={s.active} />
                      </td>
                      <td className={td}>
                        <div className="flex gap-2">
                          <Btn size="sm" onClick={() => setEditing(s)}>
                            {tc('edit')}
                          </Btn>
                          <ConfirmBtn
                            busy={remove.busy}
                            onConfirm={async () => {
                              if (await remove.run(() => api(`/merchants/${merchantId}/shops/${s.id}`, { method: 'DELETE' }))) void state.reload();
                            }}
                          >
                            {tc('delete')}
                          </ConfirmBtn>
                        </div>
                      </td>
                    </>
                  ) : null}
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>{t('none')}</Empty>
          )
        }
      </Loaded>
      <ErrorNote>{remove.error}</ErrorNote>
      <Modal title={editing === 'new' ? t('add') : t('edit')} open={editing !== null} onClose={() => setEditing(null)}>
        {editing !== null ? (
          <ShopEditor
            key={editing === 'new' ? 'new' : editing.id}
            merchantId={merchantId}
            shop={editing === 'new' ? null : editing}
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
