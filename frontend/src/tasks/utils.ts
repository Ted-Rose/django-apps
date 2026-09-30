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

/**
 * "Sep 30, 2026 3:04 PM" — matches the template's
 * `|date:"M d, Y g:i A"` (task_detail.html's last-updated line).
 * Uses local time like Django's TIME_ZONE-aware rendering.
 */
export function formatDateTime(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  let hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${hours}:${minutes} ${ampm}`;
}

/** Equivalent of Django's `|truncatewords:n` (adds "…" when cut). */
export function truncateWords(text: string, count: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= count) return text;
  return `${words.slice(0, count).join(' ')} …`;
}

/** BrowserRouter basename from main.tsx. */
const SPA_BASENAME = '/tasks/app';

/**
 * Convert a stored absolute path (localStorage `lastTasksView` /
 * `taskListReferrer`, written as `location.pathname + search`) into
 * a router `to` value the SPA can navigate to internally. Returns
 * null for non-SPA paths (e.g. template-UI `/tasks/...` URLs) —
 * callers fall back to the dashboard.
 */
export function spaPathFromStoredUrl(stored: string | null): string | null {
  if (!stored) return null;
  if (stored === SPA_BASENAME) return '/';
  if (stored.startsWith(`${SPA_BASENAME}/`)) {
    return stored.slice(SPA_BASENAME.length);
  }
  if (
    stored.startsWith(`${SPA_BASENAME}?`) ||
    stored.startsWith(`${SPA_BASENAME}#`)
  ) {
    return `/${stored.slice(SPA_BASENAME.length)}`;
  }
  return null;
}
