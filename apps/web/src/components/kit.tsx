'use client';

import { transliterateBg } from '@ba/shared';
import { useLocale, useTranslations } from 'next-intl';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, errorKey } from '@/lib/api-client';

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ─── Data ───

/** Loads an endpoint; `reload()` refetches. Errors are translated i18n keys. */
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const tr = useTranslations();
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const r = await api<T>(path);
      if (id === seq.current) setData(r);
    } catch (err) {
      if (id === seq.current) setError(tr(errorKey(err) as never));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [path, tr]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, loading, error, reload: load, setData };
}

/** Runs a mutation and exposes busy/error/field errors (translated). */
export function useAction() {
  const tr = useTranslations();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const run = useCallback(
    async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
      setBusy(true);
      setError(null);
      setFields({});
      try {
        return await fn();
      } catch (err) {
        if (err instanceof ApiError) setFields(err.fields);
        setError(tr(errorKey(err) as never));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [tr],
  );
  return { busy, error, fields, run, field: (k: string) => (fields[k] ? tr(fields[k] as never) : null), clear: () => setError(null) };
}

// ─── Formatting ───

export function useFmt() {
  const locale = useLocale();
  const tag = locale === 'en' ? 'en-GB' : 'bg-BG';
  const t = useTranslations('units');
  const tm = useTranslations('commissionTerms');
  return useMemo(() => {
    const eur = new Intl.NumberFormat(tag, { style: 'currency', currency: 'EUR' });
    const num = new Intl.NumberFormat(tag, { maximumFractionDigits: 3 });
    const pct = new Intl.NumberFormat(tag, { maximumFractionDigits: 2 });
    const day = new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeZone: 'UTC' });
    const dt = new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Sofia' });
    return {
      money: (cents: number | null | undefined) => (cents === null || cents === undefined ? '-' : eur.format(Number(cents) / 100)),
      unit: (u: string) => t(u as never),
      qty: (milli: number, unit?: string) => `${num.format(Number(milli) / 1000)}${unit ? ` ${t(unit as never)}` : ''}`,
      pct: (bp: number | null | undefined) => (bp === null || bp === undefined ? '-' : `${pct.format(bp / 100)}%`),
      /** A commission: "10%" or "0,20 € / unit"; with goods that have their own amount, "... + by goods". */
      commission: (type: string | null | undefined, bp: number | null | undefined, unitCents: number | null | undefined, byGoods?: boolean) =>
        `${type === 'per_unit' ? `${eur.format(Number(unitCents ?? 0) / 100)} / ${t('perUnit')}` : bp === null || bp === undefined ? '-' : `${pct.format(bp / 100)}%`}${byGoods ? ` + ${tm('byGoods')}` : ''}`,
      date: (iso: string | null | undefined) => (iso ? day.format(new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)) : '-'),
      dateTime: (iso: string | null | undefined) => (iso ? dt.format(new Date(iso)) : '-'),
      /** Cents → the "12.50" text of a money input. */
      eurInput: (cents: number | null | undefined) => (cents === null || cents === undefined ? '' : (Number(cents) / 100).toFixed(2)),
    };
  }, [tag, t, tm]);
}

export const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(new Date());

// ─── Layout ───

export function PageHeader({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{title}</h1>
        {children ? <div className="mt-1 text-[14px] text-neutral-600">{children}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-md border border-neutral-200 bg-white shadow-sm', className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
          {title ? <h2 className="text-[13px] font-semibold uppercase tracking-wide text-neutral-600">{title}</h2> : <span />}
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'red' | 'green' | 'amber' }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-[12px] font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={cx('mt-1 text-2xl font-semibold tabular-nums', tone === 'red' ? 'text-red-700' : tone === 'green' ? 'text-green-700' : tone === 'amber' ? 'text-amber-700' : 'text-neutral-900')}>{value}</p>
      {sub ? <p className="mt-1 text-[12px] text-neutral-500">{sub}</p> : null}
    </div>
  );
}

/** Label/value pairs. */
export function Facts({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 text-[14px] sm:grid-cols-[minmax(120px,max-content)_1fr]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-neutral-500">{k}</dt>
          <dd className="min-w-0 break-words text-neutral-900">{v ?? '-'}</dd>
        </div>
      ))}
    </dl>
  );
}

// ─── Controls ───

export function Btn({
  tone = 'default',
  size = 'md',
  busy,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'default' | 'danger' | 'ghost'; size?: 'sm' | 'md'; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-[14px]',
        tone === 'primary' && 'bg-ink text-white hover:bg-ink-soft',
        tone === 'default' && 'border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50',
        tone === 'danger' && 'border border-red-300 bg-white text-red-700 hover:bg-red-50',
        tone === 'ghost' && 'text-neutral-600 hover:bg-neutral-100',
        className,
      )}
    >
      {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" /> : null}
      {children}
    </button>
  );
}

/** Two-step delete: first click arms, second click confirms (no browser dialogs). */
export function ConfirmBtn({ onConfirm, children, busy, size = 'sm' }: { onConfirm(): void; children: ReactNode; busy?: boolean; size?: 'sm' | 'md' }) {
  const t = useTranslations('common');
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <Btn
      tone="danger"
      size={size}
      busy={busy}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? t('confirm') : children}
    </Btn>
  );
}

const inputCls = (error?: string | null) =>
  cx(
    'block w-full rounded-md border bg-white px-2.5 py-1.5 text-[14px] text-neutral-900 outline-none focus:border-gold focus:ring-1 focus:ring-gold disabled:bg-neutral-50 disabled:text-neutral-500',
    error ? 'border-red-400' : 'border-neutral-300',
  );

export function In({ label, error, hint, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; error?: string | null; hint?: ReactNode }) {
  return (
    <label className={cx('block', className)}>
      {label ? <span className="mb-1 block text-[12px] font-medium text-neutral-600">{label}</span> : null}
      <input className={inputCls(error)} {...props} />
      {error ? <span className="mt-1 block text-[12px] text-red-600">{error}</span> : hint ? <span className="mt-1 block text-[12px] text-neutral-500">{hint}</span> : null}
    </label>
  );
}

export function Sel({ label, error, hint, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; error?: string | null; hint?: ReactNode }) {
  return (
    <label className={cx('block', className)}>
      {label ? <span className="mb-1 block text-[12px] font-medium text-neutral-600">{label}</span> : null}
      <select className={inputCls(error)} {...props}>
        {children}
      </select>
      {error ? <span className="mt-1 block text-[12px] text-red-600">{error}</span> : hint ? <span className="mt-1 block text-[12px] text-neutral-500">{hint}</span> : null}
    </label>
  );
}

export function Txt({ label, error, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; error?: string | null }) {
  return (
    <label className={cx('block', className)}>
      {label ? <span className="mb-1 block text-[12px] font-medium text-neutral-600">{label}</span> : null}
      <textarea className={cx(inputCls(error), 'min-h-20 leading-relaxed')} {...props} />
      {error ? <span className="mt-1 block text-[12px] text-red-600">{error}</span> : null}
    </label>
  );
}

export function Check({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 text-[14px] text-neutral-800', className)}>
      <input type="checkbox" className="h-4 w-4 accent-[#b8862f]" {...props} />
      {label}
    </label>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{children}</p>;
}

export function OkNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-[13px] text-green-700">{children}</p>;
}

export function InfoNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[13px] text-blue-800">{children}</p>;
}

export function Loading() {
  const t = useTranslations('common');
  return <p className="py-10 text-center text-[14px] text-neutral-500">{t('loading')}</p>;
}

export function Empty({ children }: { children?: ReactNode }) {
  const t = useTranslations('common');
  return <p className="py-8 text-center text-[14px] text-neutral-500">{children ?? t('empty')}</p>;
}

/** Loading / error / content in one line. */
export function Loaded<T>({ state, children }: { state: { data: T | null; loading: boolean; error: string | null }; children: (data: T) => ReactNode }) {
  if (state.error) return <ErrorNote>{state.error}</ErrorNote>;
  if (!state.data) return <Loading />;
  return <>{children(state.data)}</>;
}

// ─── Tables & badges ───

export function Table({ head, children, foot }: { head: ReactNode[]; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white shadow-sm">
      <table className="w-full text-left text-[14px]">
        <thead className="border-b border-neutral-200 bg-neutral-50 text-[12px] uppercase tracking-wide text-neutral-500">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">{children}</tbody>
        {foot ? <tfoot className="border-t border-neutral-200 bg-neutral-50 font-medium">{foot}</tfoot> : null}
      </table>
    </div>
  );
}

export const td = 'px-3 py-2 align-middle';
export const tdNum = 'px-3 py-2 align-middle text-right tabular-nums whitespace-nowrap';

export type Tone = 'green' | 'amber' | 'red' | 'gray' | 'blue';

export function Badge({ children, tone }: { children: ReactNode; tone?: Tone }) {
  const tones: Record<Tone, string> = {
    green: 'bg-green-50 text-green-700 ring-green-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    gray: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
    blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  };
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset', tones[tone ?? 'gray'])}>{children}</span>;
}

export function Pager({ page, perPage, total, onPage }: { page: number; perPage: number; total: number; onPage(p: number): void }) {
  const t = useTranslations('common');
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-[13px] text-neutral-600">
      <Btn size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('prev')}
      </Btn>
      <span>{t('page', { page, pages })}</span>
      <Btn size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('next')}
      </Btn>
    </div>
  );
}

/** Search (either alphabet: "sirene" finds "Сирене") and paging over a list loaded in full. */
export function useListFilter<T>(rows: T[] | null | undefined, text: (row: T) => string, perPage = 25) {
  const [q, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const matched = useMemo(() => {
    const needle = transliterateBg(q.trim());
    const all = rows ?? [];
    return needle ? all.filter((r) => transliterateBg(text(r)).includes(needle)) : all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q]);
  const pages = Math.max(1, Math.ceil(matched.length / perPage));
  const current = Math.min(page, pages);
  return {
    q,
    setQ: (v: string) => {
      setQuery(v);
      setPage(1);
    },
    page: current,
    setPage,
    perPage,
    total: matched.length,
    rows: matched.slice((current - 1) * perPage, current * perPage),
  };
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-neutral-200">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx('-mb-px border-b-2 px-3 py-2 text-[14px] transition', value === o.value ? 'border-gold font-medium text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-800')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A centred dialog. Escape and the backdrop close it. */
export function Modal({ title, open, onClose, children, wide }: { title: ReactNode; open: boolean; onClose(): void; children: ReactNode; wide?: boolean }) {
  const t = useTranslations('common');
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-10" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={cx('w-full rounded-lg bg-white shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button type="button" aria-label={t('close')} className="rounded p-1 text-neutral-500 hover:bg-neutral-100" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Downloads rows as a CSV file (UTF-8 with BOM, so Excel shows Cyrillic). */
/**
 * Opens a print-ready page with one table and the browser's print dialog, where it can be printed
 * or saved as PDF ("Save as PDF"). The browser renders Cyrillic itself, so no font embedding is needed.
 * `numeric` marks the columns to align right.
 */
export function printTable(title: string, head: string[], rows: (string | number | null | undefined)[][], opts: { subtitle?: string; numeric?: number[]; footer?: (string | number | null | undefined)[] } = {}) {
  const esc = (v: string | number | null | undefined) =>
    (v === null || v === undefined ? '' : String(v)).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const num = new Set(opts.numeric ?? []);
  const cell = (tag: 'td' | 'th', v: string | number | null | undefined, i: number) => `<${tag}${num.has(i) ? ' class="n"' : ''}>${esc(v)}</${tag}>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; margin: 0; }
    h1 { font-size: 16px; margin: 0 0 2px; } p { margin: 0 0 10px; color: #555; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; vertical-align: top; }
    th { background: #eee; } td.n, th.n { text-align: right; white-space: nowrap; }
    tfoot td { font-weight: bold; background: #f6f6f6; }
    thead { display: table-header-group; } tr { page-break-inside: avoid; }
  </style></head><body><h1>${esc(title)}</h1>${opts.subtitle ? `<p>${esc(opts.subtitle)}</p>` : ''}
  <table><thead><tr>${head.map((h, i) => cell('th', h, i)).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((v, i) => cell('td', v, i)).join('')}</tr>`).join('')}</tbody>
  ${opts.footer ? `<tfoot><tr>${opts.footer.map((v, i) => cell('td', v, i)).join('')}</tr></tfoot>` : ''}
  </table><script>window.onload = () => { window.focus(); window.print(); };</script></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const w = window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return Boolean(w);
}

/** "Export": CSV download or a print-ready table (print or save as PDF). */
export function ExportButtons({ onCsv, onPdf, disabled }: { onCsv(): void; onPdf(): void; disabled?: boolean }) {
  const t = useTranslations('common');
  return (
    <div className="flex items-center gap-1">
      <span className="text-[12px] text-neutral-500">{t('export')}:</span>
      <Btn size="sm" onClick={onCsv} disabled={disabled}>
        CSV
      </Btn>
      <Btn size="sm" onClick={onPdf} disabled={disabled}>
        PDF
      </Btn>
    </div>
  );
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = `﻿${rows.map((r) => r.map(esc).join(';')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
