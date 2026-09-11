import type { Database } from 'better-sqlite3';
import type { Seed, SeedSource, SourceContext } from '../engine/seeds.js';

import { JETZT_SQL } from '../lib/zeit.js';
// Webhook/API ingest. External systems (agents, CI, monitoring, other
// tools) POST tensions to /api/seeds; each cycle drains the queue. This is
// how "running agents, newsletters, jobs, daily changes" attach to the
// engine without Loomwerk having to know them.
//
// The queue is always drained — no source registration required. Draining
// marks rows consumed; the hypothesis dedup ledger protects against
// re-posts of the same key.

export interface PendingSeedInput {
  key: string;
  tension: string;
  seedType?: string;
  domain?: string;
  topic?: string;
  mode?: 'setup' | 'idea';
  refs?: Record<string, unknown>;
}

export function enqueueSeed(db: Database, input: PendingSeedInput): number {
  const key = input.key?.trim();
  const tension = input.tension?.trim();
  if (!key || !tension) throw new Error('key and tension are required');
  const res = db
    .prepare(
      `INSERT INTO pending_seeds (key, seed_type, domain, topic, mode, tension, refs)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      key,
      input.seedType ?? 'webhook',
      input.domain ?? 'external',
      input.topic ?? null,
      input.mode === 'setup' ? 'setup' : 'idea',
      tension,
      JSON.stringify(input.refs ?? {}),
    );
  return Number(res.lastInsertRowid);
}

export const webhookSource: SeedSource = {
  kind: 'webhook',
  name: 'API ingest',
  detect(ctx: SourceContext): Promise<Seed[]> {
    const rows = ctx.db
      .prepare('SELECT * FROM pending_seeds WHERE consumed_at IS NULL ORDER BY id ASC LIMIT 20')
      .all() as Array<{
      id: number;
      key: string;
      seed_type: string;
      domain: string | null;
      topic: string | null;
      mode: 'setup' | 'idea';
      tension: string;
      refs: string;
    }>;
    const seeds: Seed[] = [];
    for (const row of rows) {
      let refs: Record<string, unknown> = {};
      try {
        refs = JSON.parse(row.refs) as Record<string, unknown>;
      } catch {
        // keep empty refs
      }
      seeds.push({
        key: row.key,
        seedType: row.seed_type,
        domain: row.domain ?? 'external',
        ...(row.topic ? { topic: row.topic } : {}),
        mode: row.mode,
        tension: row.tension,
        refs,
      });
      ctx.db.prepare(`UPDATE pending_seeds SET consumed_at=${JETZT_SQL} WHERE id=?`).run(row.id);
    }
    return Promise.resolve(seeds);
  },
};
