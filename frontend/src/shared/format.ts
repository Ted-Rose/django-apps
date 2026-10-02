/**
 * Locale-aware formatting bound to the active i18next language.
 * Use these instead of bare toLocaleString()/toLocaleDateString() —
 * they follow `i18n.language` (the stored user pref), not the
 * browser's default locale. Currency codes stay the transaction's
 * own (data); only separators/grouping localize.
 */
import i18n from './i18n';

export function fmtMoney(amount: number | string, currency: string): string {
  return new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency,
  }).format(Number(amount));
}

/**
 * Same shapes the bare toLocale* calls produced (all-numeric date,
 * date+time with seconds) — only the locale is now the user's.
 */
export function fmtDate(value: Date | string): string {
  return new Date(value).toLocaleDateString(i18n.language);
}

export function fmtDateTime(value: Date | string): string {
  return new Date(value).toLocaleString(i18n.language);
}

/** Long-form date — "March 31, 2025" / "2025. gada 31. marts". */
export function fmtDateLong(value: Date | string): string {
  return new Intl.DateTimeFormat(i18n.language, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

/** 'YYYY-MM' → localized "March 2026" month option label. */
export function fmtMonth(value: string): string {
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(i18n.language, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));
}

export function fmtNumber(value: number | string): string {
  return new Intl.NumberFormat(i18n.language).format(Number(value));
}
