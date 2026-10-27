# Changelog

## Unreleased

### Security

Both issues were found in a source-level security review (2026-10-27) and
were reachable with the default configuration (loopback, empty token). They
were traced in the source, not reproduced against a real browser.

- **DNS rebinding blocked.** The server now checks the `Host` header. IP
  addresses, `localhost` and `*.localhost` work as before; any other name gets
  403 unless it is listed in the new `LOOMWERK_ALLOWED_HOSTS`. Before, a web
  page could re-resolve its own domain to 127.0.0.1 and use the open API
  through the operator's browser — reading and writing data, starting cycles.
- **Cross-site requests blocked.** `POST`/`PATCH`/`PUT`/`DELETE` with
  `Sec-Fetch-Site: cross-site`, or with an `Origin` that is not Loomwerk's own
  (same host and port as the request, or a name from `LOOMWERK_ALLOWED_HOSTS`
  for reverse proxies that rewrite `Host`), get 403. A plain form on
  any web page could start LLM cycles (`/api/engine/cycle`) on the operator's
  key, no preflight needed. curl, webhooks and scripts send neither header and
  are unaffected.

### Changed

- Runtime dependencies raised for three advisories:
  - `zod` 4.4.3 → 4.6.7 — memory exhaustion while validating oversized
    constrained collections ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)).
    The minimum in `package.json` is now `^4.6.7`, so the published package
    requires it too.
  - `body-parser` 2.3.0 → 2.4.0 (via express) — denial of service via trailing
    bytes after a compressed request body ([GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)).
  - `fast-uri` 3.1.8 → 3.1.9 (via the MCP SDK's `ajv`) — four URI parsing
    advisories, among them scheme spoofing and host confusion
    ([GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg),
    [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr)).

  The last two are lockfile updates within the existing ranges; a fresh install
  of the package resolves the fixed versions as well (checked). `npm audit`: 0
  as of 27.10.2026, for the repository and for a fresh package install.

### Upgrade note

- If you reach Loomwerk through a domain (reverse proxy) or a Docker service
  name, add that name to `LOOMWERK_ALLOWED_HOSTS`. Otherwise every request
  gets 403, with a message that names the setting.

## 0.3.3 — 2026-10-22

### Fixed

- **No more silent exit when the port is unavailable.** Express 5 calls the
  `listen` callback with the error; Loomwerk ignored it, printed "listening"
  and exited with code 0. It now reports the error, hints at `LOOMWERK_PORT`
  (and at Windows' reserved port ranges, which can include the default
  7791) and exits with code 1.

### Changed

- Dev dependency `vite` raised (high advisory in the dev server, fixed upstream);
  not part of the published package. `npm audit`: 0 as of 22.10.2026.

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
