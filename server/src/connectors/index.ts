import type { Database } from 'better-sqlite3';
import type { SeedSource } from '../engine/seeds.js';
import { demoSource } from '../engine/seeds.js';
import { createMarkdownSource, type MarkdownConfig } from './markdown.js';
import { createRssSource, type RssConfig } from './rss.js';
import { createJsonlSource, type JsonlConfig } from './jsonl.js';
import { webhookSource } from './webhook.js';

// Connector registry: rows in the sources table become live SeedSource
// instances. Unknown kinds are skipped with a log line instead of failing
// the whole cycle — a broken source must never take the engine down.

export interface SourceRow {
  id: number;
  kind: string;
  name: string;
  config: string;
  enabled: number;
}

export function instantiateSource(row: SourceRow): SeedSource | null {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(row.config) as Record<string, unknown>;
  } catch {
    console.error(`[sources] '${row.name}': config is not valid JSON — skipped`);
    return null;
  }
  switch (row.kind) {
    case 'markdown':
      if (typeof config.path !== 'string' || !config.path) {
        console.error(`[sources] '${row.name}': markdown source needs config.path — skipped`);
        return null;
      }
      return createMarkdownSource(row.id, row.name, config as unknown as MarkdownConfig);
    case 'rss':
      if (typeof config.url !== 'string' || !config.url) {
        console.error(`[sources] '${row.name}': rss source needs config.url — skipped`);
        return null;
      }
      return createRssSource(row.name, config as unknown as RssConfig);
    case 'jsonl':
      if (typeof config.path !== 'string' || !config.path) {
        console.error(`[sources] '${row.name}': jsonl source needs config.path — skipped`);
        return null;
      }
      return createJsonlSource(row.name, config as unknown as JsonlConfig);
    case 'demo':
      return demoSource;
    default:
      console.error(`[sources] '${row.name}': unknown kind '${row.kind}' — skipped`);
      return null;
  }
}

/**
 * All active sources for a cycle. The webhook queue is always drained; the
 * demo source only jumps in when nothing real is configured (and can be
 * silenced with LOOMWERK_DEMO_SEEDS=0).
 */
export function loadSources(db: Database): SeedSource[] {
  const rows = db
    .prepare('SELECT id, kind, name, config, enabled FROM sources WHERE enabled = 1 ORDER BY id')
    .all() as SourceRow[];
  const sources = rows
    .map(instantiateSource)
    .filter((s): s is SeedSource => s !== null);
  if (!sources.length && process.env.LOOMWERK_DEMO_SEEDS !== '0') {
    sources.push(demoSource);
  }
  sources.push(webhookSource);
  return sources;
}
