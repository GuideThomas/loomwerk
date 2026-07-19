# Contributing to Loomwerk

Great that you want to help. A few ground rules keep this pleasant for
everyone.

## Before you start

- **CLA:** Loomwerk is dual-licensed. Non-trivial contributions require
  agreeing to the [CLA](CLA.md) (one line in your first PR, that's it).
- **Discuss first:** for anything bigger than a bugfix, open an issue before
  writing code. The engine has deliberately opinionated mechanics (culling,
  anti-echo, grounding) — changes there need a short design discussion.

## Expectations

Loomwerk is maintained as a **working system, not a product**. Issues and PRs
are answered best-effort. Small, focused PRs get reviewed much faster than
large ones.

## Development setup

```bash
npm install
npm run dev        # server on :7791 (API + client dev proxy)
npm run build      # typecheck + build both workspaces
npm run test       # server smoke tests
```

Requirements: Node >= 20. The database is a local SQLite file under `data/`,
created on first start.

## Code style

- TypeScript strict mode; the build gate is `tsc --noEmit` — keep it green.
- No `any` unless there is a comment explaining why.
- User-facing strings live in `client/src/locales/` (English + German). If you
  touch UI text, update both files — German with real umlauts (ä/ö/ü/ß).
- Migrations are append-only: never edit an existing migration, add a new one.

## Commit messages

Conventional-ish: `feat: …`, `fix: …`, `docs: …`, `engine: …`. Reference the
issue if one exists.
