# Writing a connector

A connector turns something you already have — notes, feeds, logs, another
tool — into *seeds*: observed tensions the engine can breed on. The four
built-in connectors live in `server/src/connectors/`; a new one is usually
under 100 lines.

## The contract

```ts
import type { Seed, SeedSource, SourceContext } from '../engine/seeds.js';

export const mySource: SeedSource = {
  kind: 'mykind',
  name: 'My source',
  async detect(ctx: SourceContext): Promise<Seed[]> {
    // ctx.db       — the SQLite handle (for per-source caches)
    // ctx.provider — LLM provider, or null. If you need embeddings and
    //                provider is null, return [] — never throw.
    return [];
  },
};
```

Register the kind in `server/src/connectors/index.ts` (`instantiateSource`)
and, if it should be user-creatable, add it to the API's kind whitelist in
`server/src/routes/api.ts`.

## What makes a good seed

```ts
{
  key: 'mykind:stable-identifier',
  seedType: 'cross_domain',        // free-form, shows up in provenance
  domain: 'notes',                 // niche bucket for MAP-elites
  topic: 'kitchen',                // optional finer bucket
  mode: 'idea',                    // 'idea' | 'setup' — prompt framing
  tension: '…the observed tension, quoting real material…',
  refs: { noteA: '…', noteB: '…' } // anything that helps trace provenance
}
```

Four rules, each backed by a production incident:

1. **Keys must be stable and free of volatile parts.** The key drives
   deduplication — if it contains a date or a counter, yesterday's tension
   counts as new every day and the engine re-breeds it forever.
   `normalizeSeedKey` strips dates and long numbers as a safety net, but
   design the key stable to begin with.

2. **A tension has two poles.** One article gets summarized; one note gets
   paraphrased. The interesting output happens *between* two things — two
   notes, two headlines, a signal and a silence. If your source only yields
   single items, pair them.

3. **Quote real material, and mark verified facts.** The breeding model
   will confidently invent mechanisms behind a bare label. Put what you
   actually know into the tension, and when you know something is *not*
   the case, say so with `FACTS:` / `NOT:` lines:

   ```
   FACTS: the job copies an archive nightly; its log only records exit 0.
   NOT: no restore has ever been performed from these archives.
   ```

   Seeds carrying these clauses arm the critic's fact gate — hypotheses
   that contradict a `NOT:` clause are culled before the expensive judge.

4. **Pick the mode deliberately.** `setup` keeps ideas on the user's own
   stack ("check whether…", "instrument this…"); `idea` allows
   outward-facing product/market ideas. The reality anchors differ.

## Caching embeddings

If your connector compares things semantically, cache per-item embeddings
in `source_index` keyed by `(source_id, key)` with an `mtime` — embed once,
re-embed only what changed. See `markdown.ts` for the pattern, including
cleanup of vanished items.

## Push instead of poll

If your producer can speak HTTP, you may not need a connector at all:

```bash
curl -X POST http://127.0.0.1:7791/api/seeds \
  -H 'Content-Type: application/json' \
  -d '{
    "key": "ci:flaky-suite-auth",
    "mode": "setup",
    "tension": "The auth test suite failed 4 times this week. FACTS: all four failures were timeouts in the same fixture. NOT: no code in the fixture changed in this period."
  }'
```

The queue is drained at the start of every cycle.

## Fail soft

A broken source must never take the cycle down. Catch your own errors,
log one line, return `[]`. The registry already skips sources with invalid
configs, and the pulse stage isolates per-source failures — but the best
connectors never rely on that.
