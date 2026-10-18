# Changelog

## 0.3.2 — 2026-10-18

### Fixed

- **Build:** `server/dist` is now cleaned before compiling. The 0.3.1 npm
  package still contained `server/dist/lib/zeit.js`, a stale, unused leftover
  from before the helpers were renamed to `time.ts`.

## 0.3.1 — 2026-10-18

### Fixed

- **Timestamps were shown off by the UTC offset.** SQLite's
  `datetime('now')` writes UTC without a zone marker, and the UI printed that
  value as if it were local time. Timestamps are now stored as ISO-8601 UTC
  with a trailing `Z`; existing rows and column defaults are migrated
  automatically on first start (idempotent, checked with `integrity_check`
  and `foreign_key_check`).
- **Times are displayed in the viewer's time zone and UI language** (DE/EN),
  instead of raw UTC.
- **Daily counters and the scheduler now agree on what "today" is.** The
  scheduler compares `LOOMWERK_CYCLE_HOUR` with the server's local hour, but
  booked the run — and rolled the daily request/token/cost counters — on the
  UTC day. Both now use the server's local day (set `TZ` to choose a zone).

### Changed

- Theme deep link `?theme=light|dark` (handy for screenshots).
- `@modelcontextprotocol/sdk` ^1.29.0 → ^1.32.1; `npm audit` reports
  0 vulnerabilities as of 18.10.2026.
- `.github/dependabot.yml`: security updates only.

## 0.3.0 — 2026-07-19

Token and cost accounting: tokens per stage, run and lifetime; dollars only
from two honest sources (gateway-measured or your configured rates);
optional daily token cap.

## 0.2.0 — 2026-07-19

MCP server (six tools over stdio) and the npm package (`npx loomwerk`).

## 0.1.0 — 2026-07-19

First public release: engine (pulse → critic → fitness → weave), four
connectors (Markdown/Obsidian, RSS, JSONL, webhook), web UI in DE/EN.
