import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { cosine } from '../lib/taste.js';
import { BudgetExceededError } from '../engine/provider.js';
import type { Seed, SeedSource, SourceContext } from '../engine/seeds.js';

import { JETZT_SQL } from '../lib/zeit.js';
// Markdown / Obsidian connector.
//
// The idea: innovation seeds live BETWEEN notes, not inside one. Two notes
// that are semantically close but come from different areas of the vault —
// and don't link to each other — are a tension worth breeding on. This is
// the classic cross-domain move: similarity band, not maximum similarity
// (near-identical notes are the same thought twice, not a tension).
//
// Cost model: each note is embedded once and cached in source_index, keyed
// by mtime — re-runs only pay for changed files. A 1,000-note vault costs
// one initial indexing run, then pennies.

export interface MarkdownConfig {
  path: string;
  windowDays?: number;    // how recent a note must be to anchor a pair
  simLow?: number;        // similarity band for cross-domain pairs
  simHigh?: number;
  maxSeeds?: number;
  maxRecent?: number;     // cap on recent anchors considered per run
  maxIndex?: number;      // safety cap on files indexed per run
  excludes?: string[];    // path substrings to skip (noise filter)
}

// Folders that are almost always operational noise in real vaults. Users
// extend this per source — a noise filter is not optional at scale: graph
// primitives on an unfiltered vault yield mostly machine-generated junk.
const DEFAULT_EXCLUDES = [
  '.obsidian/', '.trash/', 'templates/', 'template/', 'archive/', 'attachments/', 'assets/',
];

interface NoteInfo {
  key: string;      // relative path
  abs: string;
  mtime: number;
  topic: string;    // first folder = coarse domain bucket
  title: string;
  excerpt: string;
}

function walk(root: string, excludes: string[]): NoteInfo[] {
  const notes: NoteInfo[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).replaceAll('\\', '/');
      const relLower = rel.toLowerCase() + (e.isDirectory() ? '/' : '');
      if (e.name.startsWith('.') || excludes.some((x) => relLower.includes(x.toLowerCase()))) continue;
      if (e.isDirectory()) {
        stack.push(abs);
      } else if (e.name.toLowerCase().endsWith('.md')) {
        let stat: fs.Stats;
        try {
          stat = fs.statSync(abs);
        } catch {
          continue;
        }
        notes.push({
          key: rel,
          abs,
          mtime: Math.floor(stat.mtimeMs),
          topic: rel.includes('/') ? rel.split('/')[0]! : 'root',
          title: e.name.replace(/\.md$/i, ''),
          excerpt: '',
        });
      }
    }
  }
  return notes;
}

function readExcerpt(abs: string): string {
  let text: string;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
  // strip frontmatter and markdown noise, keep the substance
  text = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/[#*_>[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, 400);
}

// "Same subject" filter: two notes titled "Project X plan" and "Project X
// log" are one thought, not a cross-domain tension.
function sharedTitleWords(a: string, b: string): number {
  const words = (t: string) =>
    new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4));
  const wa = words(a);
  let n = 0;
  for (const w of words(b)) if (wa.has(w)) n++;
  return n;
}

// The source id is part of the key: users run several vaults in parallel,
// and two vaults with the same folder layout (daily notes!) must not
// dedupe each other's pairs.
function pairKey(sourceId: number, a: string, b: string): string {
  const h = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
  return `md:${sourceId}:pair:${[h(a), h(b)].sort().join('x')}`;
}

interface IndexRow {
  key: string;
  mtime: number;
  meta: string;
  vec: string | null;
}

export function createMarkdownSource(sourceId: number, name: string, config: MarkdownConfig): SeedSource {
  const windowDays = config.windowDays ?? 21;
  const simLow = config.simLow ?? 0.64;
  const simHigh = config.simHigh ?? 0.82;
  const maxSeeds = config.maxSeeds ?? 6;
  const maxRecent = config.maxRecent ?? 30;
  const maxIndex = config.maxIndex ?? 300;
  const excludes = [...DEFAULT_EXCLUDES, ...(config.excludes ?? [])];

  async function refreshIndex(ctx: SourceContext, notes: NoteInfo[]): Promise<void> {
    const { db, provider } = ctx;
    if (!provider) return;
    const known = new Map<string, number>();
    for (const row of db
      .prepare('SELECT key, mtime FROM source_index WHERE source_id = ?')
      .all(sourceId) as IndexRow[]) {
      known.set(row.key, row.mtime);
    }
    // Drop index entries whose file vanished.
    const alive = new Set(notes.map((n) => n.key));
    for (const key of known.keys()) {
      if (!alive.has(key)) db.prepare('DELETE FROM source_index WHERE source_id=? AND key=?').run(sourceId, key);
    }
    let indexed = 0;
    for (const note of notes) {
      if (indexed >= maxIndex) break;
      if (known.get(note.key) === note.mtime) continue;
      note.excerpt = readExcerpt(note.abs);
      const input = `${note.title}\n${note.excerpt}`.trim();
      if (!input) continue;
      try {
        const vec = await provider.embed(provider.models.embed, input);
        db.prepare(
          `INSERT INTO source_index (source_id, key, mtime, meta, vec) VALUES (@sid, @key, @mtime, @meta, @vec)
           ON CONFLICT(source_id, key) DO UPDATE SET mtime=@mtime, meta=@meta, vec=@vec, updated_at=${JETZT_SQL}`,
        ).run({
          sid: sourceId,
          key: note.key,
          mtime: note.mtime,
          meta: JSON.stringify({ title: note.title, topic: note.topic, excerpt: note.excerpt.slice(0, 200) }),
          vec: JSON.stringify(vec),
        });
        indexed++;
      } catch (e) {
        if (e instanceof BudgetExceededError) throw e;
        // single file failure: skip, try again next run
      }
    }
  }

  function loadIndex(db: Database): Map<string, { mtime: number; title: string; topic: string; excerpt: string; vec: number[] }> {
    const out = new Map<string, { mtime: number; title: string; topic: string; excerpt: string; vec: number[] }>();
    for (const row of db
      .prepare('SELECT key, mtime, meta, vec FROM source_index WHERE source_id = ? AND vec IS NOT NULL')
      .all(sourceId) as IndexRow[]) {
      try {
        const meta = JSON.parse(row.meta) as { title?: string; topic?: string; excerpt?: string };
        out.set(row.key, {
          mtime: row.mtime,
          title: meta.title ?? row.key,
          topic: meta.topic ?? 'root',
          excerpt: meta.excerpt ?? '',
          vec: JSON.parse(row.vec!) as number[],
        });
      } catch {
        continue;
      }
    }
    return out;
  }

  return {
    kind: 'markdown',
    name,
    async detect(ctx: SourceContext): Promise<Seed[]> {
      if (!fs.existsSync(config.path)) {
        console.error(`[markdown:${name}] path not found: ${config.path}`);
        return [];
      }
      const notes = walk(config.path, excludes);
      await refreshIndex(ctx, notes);
      const index = loadIndex(ctx.db);
      if (index.size < 2) return [];

      const cutoff = Date.now() - windowDays * 86_400_000;
      const entries = [...index.entries()];
      const recent = entries
        .filter(([, v]) => v.mtime >= cutoff)
        .sort((a, b) => b[1].mtime - a[1].mtime)
        .slice(0, maxRecent);

      const seeds: Seed[] = [];
      const used = new Set<string>();
      // Prefer new×new pairs, then let recent notes pair with the deep pool.
      const pools = [recent, entries] as const;
      for (const pool of pools) {
        for (const [keyA, a] of recent) {
          if (seeds.length >= maxSeeds) return seeds;
          if (used.has(keyA)) continue;
          let best: { key: string; sim: number } | null = null;
          for (const [keyB, b] of pool) {
            if (keyA === keyB || used.has(keyB)) continue;
            if (a.topic === b.topic) continue;
            if (sharedTitleWords(a.title, b.title) >= 2) continue;
            const sim = cosine(a.vec, b.vec);
            if (sim < simLow || sim > simHigh) continue;
            if (!best || sim > best.sim) best = { key: keyB, sim };
          }
          if (!best) continue;
          const b = index.get(best.key)!;
          used.add(keyA);
          used.add(best.key);
          seeds.push({
            key: pairKey(sourceId, keyA, best.key),
            seedType: 'cross_domain',
            domain: 'notes',
            topic: a.topic,
            mode: 'idea',
            tension:
              `Two notes from different areas are semantically close (cos ${best.sim.toFixed(2)}) but unconnected:\n` +
              `A [${a.topic}] "${a.title}": ${a.excerpt.slice(0, 180)}\n` +
              `B [${b.topic}] "${b.title}": ${b.excerpt.slice(0, 180)}`,
            refs: { noteA: keyA, noteB: best.key, sim: Math.round(best.sim * 100) / 100 },
          });
        }
      }
      return seeds;
    },
  };
}
