// ── Displaying timestamps ────────────────────────────────────────────────────
//
// The server stores every timestamp as ISO-8601 UTC with a trailing `Z`
// (see server/src/lib/time.ts). Here they are shown in the viewer's own time
// zone and in the UI language (DE/EN switch).
//
// Two rules keep this correct:
// - Never `new Date(value)` on a raw database string. Rows written before
//   v0.3.1 carry no zone marker; `new Date` reads such a string as LOCAL time
//   and shifts it by the local offset. `toDate()` reads it as UTC instead.
// - Never a fixed offset like "+2". Offsets change with daylight saving time;
//   `Intl` with the viewer's zone carries the change by itself.

import i18n from '../i18n';

/** Locale for date and time formats, following the UI language. */
function locale(): string {
  return i18n.language === 'de' ? 'de-DE' : 'en-GB';
}

/**
 * Reads a timestamp from the database into a `Date`.
 *
 * A value without a zone marker is read as UTC, NOT as local time — the
 * opposite of what `new Date(...)` does.
 *
 * @returns a `Date`, or `null` if the value was empty or unreadable
 */
export function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }

  const raw = String(value).trim();
  if (raw === '') return null;

  // Already carries a zone (Z or +02:00 / -05:00)? Parse directly.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const withZone = new Date(raw.replace(' ', 'T'));
    return Number.isNaN(withZone.getTime()) ? null : withZone;
  }

  // Zone-less → read as UTC. This is the legacy form from datetime('now').
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if (match) {
    const [, date, hourMinute, second] = match;
    const asUtc = new Date(`${date}T${hourMinute}:${second ?? '00'}Z`);
    return Number.isNaN(asUtc.getTime()) ? null : asUtc;
  }

  // Plain date without a time — midnight UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const dateOnly = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(dateOnly.getTime()) ? null : dateOnly;
  }

  const rest = new Date(raw);
  return Number.isNaN(rest.getTime()) ? null : rest;
}

/** Formatters, cached per locale and options — `Intl` is costly to create. */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const loc = locale();
  const key = loc + JSON.stringify(options);
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(loc, options);
    formatters.set(key, cached);
  }
  return cached;
}

/** Date and time — the default for timestamps in the UI. */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  fallback = '—',
): string {
  const date = toDate(value);
  if (!date) return fallback;
  return formatter({
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

/** Date only. */
export function formatDate(
  value: string | number | Date | null | undefined,
  fallback = '—',
): string {
  const date = toDate(value);
  if (!date) return fallback;
  return formatter({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

/** Time only. */
export function formatTime(
  value: string | number | Date | null | undefined,
  fallback = '—',
): string {
  const date = toDate(value);
  if (!date) return fallback;
  return formatter({ hour: '2-digit', minute: '2-digit' }).format(date);
}

/** Date and time with seconds — for logs and run histories. */
export function formatDateTimePrecise(
  value: string | number | Date | null | undefined,
  fallback = '—',
): string {
  const date = toDate(value);
  if (!date) return fallback;
  return formatter({
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date);
}
