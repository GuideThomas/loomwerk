import type { Database } from 'better-sqlite3';

// A seed is an observed *tension* — the raw material of the engine. Sources
// (connectors) produce seeds; the pulse turns fresh ones into hypotheses.
//
// Design contract for connector authors:
//  * `key` must be stable across runs for the same underlying tension, and
//    free of volatile parts (dates, counters) — it drives deduplication.
//  * `tension` should quote real material (titles, numbers, excerpts). If it
//    carries verified facts, mark them with "FACTS:" / "NOT:" lines — the
//    critic's fact gate uses these to kill confabulated mechanisms.
//  * `mode` decides the prompt framing: 'setup' keeps ideas on the user's
//    own stack, 'idea' allows outward-facing product/market ideas.

export interface Seed {
  key: string;
  seedType: string;
  domain: string;
  topic?: string;
  mode: 'setup' | 'idea';
  tension: string;
  refs: Record<string, unknown>;
}

export interface SeedSource {
  kind: string;
  name: string;
  detect(): Promise<Seed[]>;
}

// Volatile fragments (dates, big numbers) are stripped before comparison so
// that yesterday's "backlog-2026-07-18" doesn't count as a new tension today.
export function normalizeSeedKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}/g, '')
    .replace(/\d{3,}/g, '')
    .replace(/[^a-z0-9:/_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function existingSeedKeys(db: Database): Set<string> {
  const keys = new Set<string>();
  const rows = db.prepare('SELECT seed_refs FROM hypotheses WHERE seed_refs IS NOT NULL').all() as Array<{
    seed_refs: string;
  }>;
  for (const row of rows) {
    try {
      const refs = JSON.parse(row.seed_refs) as { key?: string };
      if (refs.key) keys.add(normalizeSeedKey(refs.key));
    } catch {
      // legacy/manual rows without JSON refs — nothing to dedupe against
    }
  }
  return keys;
}

// Bundled demo source: fictional but structurally realistic tensions, so the
// full cycle can be experienced (and tested) before any real connector or
// knowledge base is wired up. Explicitly marked as demo material.
export const demoSource: SeedSource = {
  kind: 'demo',
  name: 'Demo tensions',
  detect() {
    const seeds: Seed[] = [
      {
        key: 'demo:notes:sourdough-x-fermentation-sensors',
        seedType: 'cross_domain',
        domain: 'demo',
        topic: 'kitchen',
        mode: 'idea',
        tension:
          'Two recently edited notes share no link: "Sourdough starter log ' +
          '(day 42, feeding schedule, temperature notes)" and "Cheap ESP32 ' +
          'temperature/humidity sensors — first measurements". Both circle ' +
          'around fermentation conditions, from different directions.',
        refs: { noteA: 'sourdough-starter-log', noteB: 'esp32-sensors' },
      },
      {
        key: 'demo:notes:newsletter-x-reading-backlog',
        seedType: 'cross_domain',
        domain: 'demo',
        topic: 'knowledge',
        mode: 'idea',
        tension:
          'The note "Newsletter drafts — half-finished issues" has not been ' +
          'touched in weeks, while "Reading backlog" grows daily with tagged ' +
          'articles. One produces, one consumes — they never meet.',
        refs: { noteA: 'newsletter-drafts', noteB: 'reading-backlog' },
      },
      {
        key: 'demo:setup:backup-script-untested-restore',
        seedType: 'telemetry',
        domain: 'demo-setup',
        mode: 'setup',
        tension:
          'The nightly backup job has reported success for 180 days in a row. ' +
          'FACTS: the job copies an archive to a second disk; its log only ' +
          'records that the copy command exited 0. NOT: no restore has ever ' +
          'been performed from these archives.',
        refs: { check: 'backup-log' },
      },
    ];
    return Promise.resolve(seeds);
  },
};
