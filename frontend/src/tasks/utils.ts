/**
 * Display helpers for the tasks dashboard.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Parse `YYYY-MM-DD...` without timezone drift: date-only API values
 * (e.g. `due`) must not shift a day when `new Date()` treats them as
 * UTC midnights.
 */
function parseDateParts(value: string): {
  year: number;
  month: number;
  day: number;
} | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

/** "Sep 30, 2026" — matches the template's `|date:"M d, Y"`. */
export function formatFullDate(value?: string | null): string | null {
  if (!value) return null;
  const parts = parseDateParts(value);
  if (!parts) return null;
  return `${MONTHS[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

/** "Sep 30" — matches the template's `|date:"M d"`. */
export function formatShortDate(value?: string | null): string | null {
  if (!value) return null;
  const parts = parseDateParts(value);
  if (!parts) return null;
  return `${MONTHS[parts.month - 1]} ${parts.day}`;
}

/** Equivalent of Django's `|truncatewords:n` (adds "…" when cut). */
export function truncateWords(text: string, count: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= count) return text;
  return `${words.slice(0, count).join(' ')} …`;
}
