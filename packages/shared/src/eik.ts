/**
 * ЕИК (БУЛСТАТ / Търговски регистър): 9 digits, or 13 for a branch, with check digits.
 * A sole trader or farmer may be registered by ЕГН (10 digits, also checked).
 */
const digits = (s: string) => s.split('').map(Number);

function check9(d: number[]): boolean {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += d[i]! * (i + 1);
  let r = sum % 11;
  if (r === 10) {
    sum = 0;
    for (let i = 0; i < 8; i++) sum += d[i]! * (i + 3);
    r = sum % 11;
    if (r === 10) r = 0;
  }
  return r === d[8];
}

function check13(d: number[]): boolean {
  if (!check9(d)) return false;
  const w1 = [2, 7, 3, 5];
  const w2 = [4, 9, 5, 7];
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += d[8 + i]! * w1[i]!;
  let r = sum % 11;
  if (r === 10) {
    sum = 0;
    for (let i = 0; i < 4; i++) sum += d[8 + i]! * w2[i]!;
    r = sum % 11;
    if (r === 10) r = 0;
  }
  return r === d[12];
}

function checkEgn(d: number[]): boolean {
  const w = [2, 4, 8, 5, 10, 9, 7, 3, 6];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += d[i]! * w[i]!;
  const r = (sum % 11) % 10;
  return r === d[9];
}

export function isValidEik(value: string): boolean {
  const v = value.replace(/\s+/g, '').replace(/^BG/i, '');
  if (!/^\d+$/.test(v)) return false;
  const d = digits(v);
  if (v.length === 9) return check9(d);
  if (v.length === 13) return check13(d);
  if (v.length === 10) return checkEgn(d);
  return false;
}

/** Stored form: digits only (a "BG" VAT prefix and spaces are removed). */
export const normalizeEik = (value: string) => value.replace(/\s+/g, '').replace(/^BG/i, '');
