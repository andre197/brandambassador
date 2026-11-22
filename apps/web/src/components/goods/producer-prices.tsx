'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { Good } from '@/lib/types';
import { Card, Empty, Loaded, Table, td, tdNum, useData, useFmt } from '../kit';

/**
 * The producer's own prices: what the producer set, or what the admin approved on its request.
 * Prices agreed with single merchants are on each merchant's page, not here.
 */
export function ProducerPrices({ producerId }: { producerId: string }) {
  const t = useTranslations('producerPrices');
  const locale = useLocale();
  const f = useFmt();
  const state = useData<Good[]>(`/goods?producer_id=${producerId}`);
  return (
    <Card title={t('title')}>
      <p className="mb-3 text-[13px] text-neutral-500">{t('hint')}</p>
      <Loaded state={state}>
        {(rows) =>
          rows.length ? (
            <Table head={[t('good'), t('price'), t('vat'), t('priceGross'), t('pending'), t('changed')]}>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td className={td}>
                    <div className="font-medium">{locale === 'en' && g.name_en ? g.name_en : g.name_bg}</div>
                    {g.active ? null : <div className="text-[12px] text-neutral-500">{t('inactive')}</div>}
                  </td>
                  <td className={`${tdNum} font-medium`}>
                    {f.money(g.price_cents)} / {f.unit(g.unit)}
                  </td>
                  <td className={tdNum}>{f.pct(g.vat_bp)}</td>
                  <td className={tdNum}>{f.money(g.price_gross_cents)}</td>
                  <td className={tdNum}>
                    {g.pending_price_cents !== null && g.pending_price_cents !== undefined ? (
                      <Link href="/requests" className="text-gold hover:underline">
                        {f.money(g.pending_price_cents)}
                      </Link>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{f.date(g.updated_at)}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty />
          )
        }
      </Loaded>
    </Card>
  );
}
