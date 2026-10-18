// ── Timestamps: one notation that never hides its zone ──────────────────────
//
// SQLite's `datetime('now')` / `CURRENT_TIMESTAMP` returns "2026-09-11 19:21:02".
// That value is UTC, but the string doesn't say so — and `new Date(...)` reads
// a zone-less string as LOCAL time, which shifts it by the local offset a
// second time. Displays ended up off by exactly that offset.
//
// Storage stays UTC (no duplicate hours around DST changes); the only change
// is the trailing `Z` that makes the value unambiguous. Conversion to a zone
// happens at display time, in the client.

/**
 * SQL expression for "now" as an unambiguous ISO-8601 UTC string.
 *
 *   before: updated_at = datetime('now')   → "2026-09-11 19:21:02"
 *   after:  updated_at = ${NOW_SQL}        → "2026-09-11T19:21:02Z"
 *
 * ⚠️ Inside a column DEFAULT the expression must be parenthesised — use
 * `NOW_SQL_DEFAULT` there.
 */
export const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%SZ','now')";

/** Same as `NOW_SQL`, parenthesised for use in `DEFAULT (...)`. */
export const NOW_SQL_DEFAULT = `(${NOW_SQL})`;

/**
 * "Now" as an unambiguous ISO-8601 UTC string, for timestamps created in
 * JavaScript rather than SQL. No milliseconds, so a column never mixes two
 * notations.
 */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Brings any stored timestamp into the unambiguous notation.
 *
 * Rows written before v0.3.1 carry no zone marker. Those values ARE UTC — they
 * came from `datetime('now')` — they just don't say so. They get the `Z`
 * without the instant moving. Values that already carry a zone are left alone.
 */
export function normalizeTimestamp(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  const raw = String(value).trim();
  if (raw === '') return null;

  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return raw;

  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if (match) {
    const [, date, hourMinute, second] = match;
    return `${date}T${hourMinute}:${second ?? '00'}Z`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00Z`;

  // Unrecognised: return unchanged instead of guessing. A wrongly guessed
  // timestamp is worse than an untouched one.
  return raw;
}

/**
 * The calendar day of an instant as `YYYY-MM-DD`, in the server's local zone
 * (the system zone, or whatever `TZ` is set to).
 *
 * This is deliberately the same zone the scheduler uses: it compares
 * `getHours()` against LOOMWERK_CYCLE_HOUR, which is local time. A UTC day key
 * (`toISOString().slice(0, 10)`) would disagree with that hour for part of
 * every day — runs could book onto the previous day, and the daily token and
 * cost counters would roll over at the UTC midnight instead of the local one.
 */
export function localDay(instant: Date = new Date()): string {
  const y = instant.getFullYear();
  const m = String(instant.getMonth() + 1).padStart(2, '0');
  const d = String(instant.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
