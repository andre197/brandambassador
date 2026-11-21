// Bulgarian Streamlined System (official transliteration, 2009 law).
const BG: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
};

export function transliterateBg(input: string): string {
  let out = '';
  const lower = input.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i]!;
    // "-ия" at the end of a word is transliterated as "ia".
    if (ch === 'и' && lower[i + 1] === 'я' && !/[\p{L}]/u.test(lower[i + 2] ?? '')) {
      out += 'ia';
      i++;
      continue;
    }
    out += BG[ch] ?? ch;
  }
  return out;
}

export function slugify(input: string, maxLength = 80): string {
  return transliterateBg(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
