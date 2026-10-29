/**
 * Display helpers for the notes SPA — date/word formatting ported
 * from src/tasks/utils.ts plus the `#notes…` marker stripper that
 * mirrors services.py's NOTE_TAG_RE (hyphen-aware, unlike the shared
 * hashtag regex). The stored text keeps the marker — it is the
 * classification source of truth; these helpers are display-only.
 */

export const MONTHS = [
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
 * must not shift a day when `new Date()` treats them as UTC
 * midnights.
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
 * "Sep 30, 2026 3:04 PM" — local time like Django's TIME_ZONE-aware
 * rendering (the editor's last-updated line).
 */
export function formatDateTime(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  let hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const day = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return `${day} ${hours}:${minutes} ${ampm}`;
}

/** Equivalent of Django's `|truncatewords:n` (adds "…" when cut). */
export function truncateWords(text: string, count: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= count) return text;
  return `${words.slice(0, count).join(' ')} …`;
}

/**
 * The marker pattern — verbatim port of services.py NOTE_TAG_RE:
 * `#notes` optionally followed by `-<seg>` runs where a segment is
 * `[a-z0-9_]*` (empties allowed, so `#notes--x`/`#notes-` still
 * match and their full span strips); the lookahead stops
 * `#notebook-x`/`#notesx` matching. Case-insensitive; `g` flag so
 * every occurrence strips.
 */
const NOTE_TAG_RE = /#notes(?:-[a-z0-9_]*)*(?![a-z0-9_-])/gi;

/**
 * Remove every `#notes…` marker occurrence from `text` and collapse
 * the whitespace a stripped marker leaves behind — same semantics
 * as services.py strip_note_marker/_collapse_marker_whitespace:
 * only HORIZONTAL whitespace collapses (per-line `[ \t]+` → one
 * space, lines trimmed), so newlines in multi-paragraph bodies
 * survive a save round-trip.
 */
export function stripNoteMarker(text?: string | null): string {
  return (text ?? '')
    .replace(NOTE_TAG_RE, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .trim();
}

/** BrowserRouter basename from main.tsx. */
const SPA_BASENAME = '/notes';

/**
 * Convert a stored absolute path (localStorage `notesListReferrer`,
 * written as `location.pathname + search`) into a router `to` value
 * the SPA can navigate to internally. Returns null for non-SPA
 * paths; callers fall back to the notes list.
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
