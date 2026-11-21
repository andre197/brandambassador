import type { Locale, NotificationType } from '@ba/shared';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const INK = '#1f2a44';
const PAPER = '#f6f4ef';
const GOLD = '#b8862f';
const MUTED = '#5b6478';

const money = (locale: Locale, cents: unknown) =>
  typeof cents === 'number' ? new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'bg-BG', { style: 'currency', currency: 'EUR' }).format(cents / 100) : '';
const date = (locale: Locale, iso: unknown) =>
  typeof iso === 'string' && iso ? new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'bg-BG', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '';
const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

type D = Record<string, unknown>;
type Notice = { subject: (d: D) => string; lines: (d: D) => string[] };

const ROLE = {
  bg: { admin: 'администратора', producer: 'производителя', merchant: 'търговеца' },
  en: { admin: 'the admin', producer: 'the producer', merchant: 'the merchant' },
} as const;

const T = {
  bg: {
    brand: 'Brand Ambassador',
    open: 'Отвори в платформата',
    footer: 'Получаваш този имейл, защото имаш профил в платформата Brand Ambassador.',
    password: {
      invite: { subject: 'Покана за Brand Ambassador', intro: 'Създаден ти е профил в платформата Brand Ambassador. Избери парола, за да влезеш.', action: 'Избери парола', expires: 'Линкът е валиден 7 дни.' },
      reset: { subject: 'Нова парола за Brand Ambassador', intro: 'Поискана е нова парола за профила ти.', action: 'Задай нова парола', expires: 'Линкът е валиден 2 часа. Ако не си го поискал(а) ти, игнорирай този имейл.' },
    },
    notices: {
      order_created: { subject: (d) => `Нова поръчка №${str(d.number)}`, lines: (d) => [`${str(d.merchant)} → ${str(d.producer)}`, `Стойност без ДДС: ${money('bg', d.net)}`, `Създадена от ${ROLE.bg[(d.by as 'admin') ?? 'admin'] ?? ''}.`] },
      order_confirmed: { subject: (d) => `Поръчка №${str(d.number)} е потвърдена`, lines: (d) => [`${str(d.producer)} потвърди поръчката.`, d.planned ? `Планирана доставка: ${date('bg', d.planned)}` : ''] },
      order_delivered: { subject: (d) => `Поръчка №${str(d.number)} е доставена`, lines: (d) => [`${str(d.producer)} → ${str(d.merchant)}`, `Доставена на ${date('bg', d.delivered)}.`] },
      order_cancelled: { subject: (d) => `Поръчка №${str(d.number)} е отказана`, lines: (d) => [`${str(d.merchant)} → ${str(d.producer)}`, d.reason ? `Причина: ${str(d.reason)}` : ''] },
      order_changed: { subject: (d) => `Промяна в поръчка №${str(d.number)}`, lines: (d) => [`Администраторът промени редовете или цените на поръчката.`, `Нова стойност без ДДС: ${money('bg', d.net)}`] },
      payment_recorded: { subject: (d) => `Плащане по поръчка №${str(d.number)}`, lines: (d) => [`${str(d.merchant)} е платил ${money('bg', d.amount)} на ${date('bg', d.paidOn)}.`, d.commissionDueOn ? `Комисионната е дължима до ${date('bg', d.commissionDueOn)}.` : ''] },
      commission_received: { subject: (d) => `Получена комисионна по поръчка №${str(d.number)}`, lines: (d) => [`Отразено плащане на комисионна: ${money('bg', d.amount)} (${date('bg', d.paidOn)}).`] },
      request_created: { subject: (d) => `Искане за промяна на цена №${str(d.number)}`, lines: (d) => [`${str(d.good)}: ${str(d.producer)} → ${str(d.merchant)}`, `Сега: ${money('bg', d.current)}${d.proposed !== null && d.proposed !== undefined ? `, предложена: ${money('bg', d.proposed)}` : ''}`, d.description ? `„${str(d.description)}“` : ''] },
      request_resolved: { subject: (d) => `Искане №${str(d.number)}: ${d.decision === 'approved' ? 'одобрено' : 'отказано'}`, lines: (d) => [`${str(d.good)}`, d.decision === 'approved' ? `Нова цена: ${money('bg', d.price)}` : 'Цената остава непроменена.', d.response ? `Отговор: ${str(d.response)}` : ''] },
      reminder: { subject: (d) => `Напомняне: поръчка до ${date('bg', d.due)}`, lines: (d) => [d.producer ? `Направете поръчката си към ${str(d.producer)} до ${date('bg', d.due)}.` : `Направете поръчката си до ${date('bg', d.due)}.`, d.message ? str(d.message) : ''] },
      contract_notice: { subject: (d) => `Договорът с ${str(d.producer)} се подновява на ${date('bg', d.end)}`, lines: (d) => [`Срокът за писмен отказ от подновяване (30 дни преди края) е ${date('bg', d.notice)}.`] },
    } satisfies Record<NotificationType, Notice>,
  },
  en: {
    brand: 'Brand Ambassador',
    open: 'Open in the platform',
    footer: 'You receive this email because you have an account on the Brand Ambassador platform.',
    password: {
      invite: { subject: 'Your Brand Ambassador invitation', intro: 'An account has been created for you on the Brand Ambassador platform. Choose a password to sign in.', action: 'Choose a password', expires: 'The link is valid for 7 days.' },
      reset: { subject: 'New Brand Ambassador password', intro: 'A new password was requested for your account.', action: 'Set a new password', expires: 'The link is valid for 2 hours. If you did not ask for it, ignore this email.' },
    },
    notices: {
      order_created: { subject: (d) => `New order #${str(d.number)}`, lines: (d) => [`${str(d.merchant)} → ${str(d.producer)}`, `Value excl. VAT: ${money('en', d.net)}`, `Created by ${ROLE.en[(d.by as 'admin') ?? 'admin'] ?? ''}.`] },
      order_confirmed: { subject: (d) => `Order #${str(d.number)} confirmed`, lines: (d) => [`${str(d.producer)} confirmed the order.`, d.planned ? `Planned delivery: ${date('en', d.planned)}` : ''] },
      order_delivered: { subject: (d) => `Order #${str(d.number)} delivered`, lines: (d) => [`${str(d.producer)} → ${str(d.merchant)}`, `Delivered on ${date('en', d.delivered)}.`] },
      order_cancelled: { subject: (d) => `Order #${str(d.number)} cancelled`, lines: (d) => [`${str(d.merchant)} → ${str(d.producer)}`, d.reason ? `Reason: ${str(d.reason)}` : ''] },
      order_changed: { subject: (d) => `Order #${str(d.number)} changed`, lines: (d) => [`The admin changed the lines or prices of the order.`, `New value excl. VAT: ${money('en', d.net)}`] },
      payment_recorded: { subject: (d) => `Payment on order #${str(d.number)}`, lines: (d) => [`${str(d.merchant)} paid ${money('en', d.amount)} on ${date('en', d.paidOn)}.`, d.commissionDueOn ? `The commission is due by ${date('en', d.commissionDueOn)}.` : ''] },
      commission_received: { subject: (d) => `Commission received for order #${str(d.number)}`, lines: (d) => [`Commission payment recorded: ${money('en', d.amount)} (${date('en', d.paidOn)}).`] },
      request_created: { subject: (d) => `Price change request #${str(d.number)}`, lines: (d) => [`${str(d.good)}: ${str(d.producer)} → ${str(d.merchant)}`, `Now: ${money('en', d.current)}${d.proposed !== null && d.proposed !== undefined ? `, proposed: ${money('en', d.proposed)}` : ''}`, d.description ? `"${str(d.description)}"` : ''] },
      request_resolved: { subject: (d) => `Request #${str(d.number)}: ${d.decision === 'approved' ? 'approved' : 'rejected'}`, lines: (d) => [`${str(d.good)}`, d.decision === 'approved' ? `New price: ${money('en', d.price)}` : 'The price stays the same.', d.response ? `Reply: ${str(d.response)}` : ''] },
      reminder: { subject: (d) => `Reminder: order by ${date('en', d.due)}`, lines: (d) => [d.producer ? `Please place your order with ${str(d.producer)} by ${date('en', d.due)}.` : `Please place your order by ${date('en', d.due)}.`, d.message ? str(d.message) : ''] },
      contract_notice: { subject: (d) => `The contract with ${str(d.producer)} renews on ${date('en', d.end)}`, lines: (d) => [`The deadline for a written notice of non-renewal (30 days before the end) is ${date('en', d.notice)}.`] },
    } satisfies Record<NotificationType, Notice>,
  },
} as const;

function layout(opts: { locale: Locale; title: string; body: string; company: string | null }): string {
  const brand = opts.company ? `${T[opts.locale].brand} · ${esc(opts.company)}` : T[opts.locale].brand;
  return `<!doctype html><html lang="${opts.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(opts.title)}</title></head>
<body style="margin:0;background:${PAPER};font-family:Arial,Helvetica,sans-serif;color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e0d6">
<tr><td style="padding:18px 24px;background:${INK};color:#ffffff;font-weight:bold;letter-spacing:1px;font-size:14px">${brand}</td></tr>
<tr><td style="padding:26px 28px 8px;font-size:15px;line-height:1.6">${opts.body}</td></tr>
<tr><td style="padding:16px 28px 26px;font-size:12px;line-height:1.5;color:${MUTED}">${esc(T[opts.locale].footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:22px 0"><a href="${esc(url)}" style="background:${GOLD};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">${esc(label)}</a></p>`;
}

export function renderNoticeEmail(locale: Locale, d: { siteUrl: string; type: NotificationType; data: D; link: string | null; company: string | null }): RenderedEmail {
  const t = T[locale];
  const n = t.notices[d.type];
  const subject = n.subject(d.data);
  const lines = n.lines(d.data).filter(Boolean);
  const url = d.link ? `${d.siteUrl}${d.link}` : d.siteUrl;
  const body = `<h1 style="margin:0 0 14px;font-size:20px;color:${INK}">${esc(subject)}</h1>
${lines.map((l) => `<p style="margin:0 0 10px">${esc(l)}</p>`).join('')}${button(url, t.open)}`;
  return {
    subject,
    html: layout({ locale, title: subject, body, company: d.company }),
    text: `${subject}\n\n${lines.join('\n')}\n\n${t.open}: ${url}`,
  };
}

export function renderPasswordEmail(locale: Locale, d: { url: string; purpose: 'invite' | 'reset'; company: string | null }): RenderedEmail {
  const t = T[locale].password[d.purpose];
  const body = `<h1 style="margin:0 0 14px;font-size:20px;color:${INK}">${esc(t.subject)}</h1>
<p style="margin:0 0 10px">${esc(t.intro)}</p>${button(d.url, t.action)}
<p style="margin:0;font-size:13px;color:${MUTED}">${esc(t.expires)}</p>`;
  return {
    subject: t.subject,
    html: layout({ locale, title: t.subject, body, company: d.company }),
    text: `${t.subject}\n\n${t.intro}\n\n${t.action}: ${d.url}\n\n${t.expires}`,
  };
}
