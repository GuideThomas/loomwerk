import type { Database } from 'better-sqlite3';
import { createHypothesis } from '../lib/hypotheses.js';
import { cosine, loadCentroids } from '../lib/taste.js';
import { BudgetExceededError, extractJson, type Provider } from './provider.js';
import { pickOperator, pulsePrompt } from './prompts.js';
import { existingSeedKeys, normalizeSeedKey, type Seed, type SeedSource } from './seeds.js';

// Stage 1 — pulse (variation). Cheap tier, high volume, low expectations:
// on its own this stage is a slop machine, and that is by design. The critic
// exists precisely because 90% of what is bred here has to die.

export interface PulseOptions {
  maxPerRun?: number;
  temperature?: number;
  // Taste pre-filter: statements scoring clearly below what the user has
  // historically accepted are parked as 'dismissed' without ever burning a
  // critic call. Calibrated conservatively — it must never block a
  // borderline idea, only the noise tail. Requires a matured negative
  // centroid (min. decisions) and fails open on any error.
  tasteFloor?: number;
  tasteMinN?: number;
}

export interface PulseCounts extends Record<string, number> {
  seeds: number;
  fresh: number;
  created: number;
  tasteFiltered: number;
  errors: number;
}

// Recent human dismissal *reasons* become explicit negative anchors in the
// generation prompt — the taste centroids know the WHAT, this adds the WHY.
export function antiTasteBlock(db: Database, limit = 8): string {
  const rows = db
    .prepare(
      `SELECT h.statement, d.note FROM dispositions d
       JOIN hypotheses h ON h.id = d.hypothesis_id
       WHERE d.actor = 'human' AND d.signal = 'dismissed' AND d.note IS NOT NULL AND d.note != ''
       ORDER BY d.id DESC LIMIT ?`,
    )
    .all(limit) as Array<{ statement: string; note: string }>;
  if (!rows.length) return '';
  const items = rows.map(
    (r) =>
      `- "${r.statement.replace(/\s+/g, ' ').slice(0, 70)}…" → dismissed: ${r.note.replace(/\s+/g, ' ').slice(0, 160)}`,
  );
  return (
    'ANTI-TASTE — the operator recently dismissed provocations for these ' +
    'reasons. Avoid these FAILURE CLASSES (the patterns, not the words):\n' +
    items.join('\n') +
    '\n\n'
  );
}

export async function runPulse(
  db: Database,
  provider: Provider,
  sources: SeedSource[],
  opts: PulseOptions = {},
): Promise<PulseCounts> {
  const maxPerRun = opts.maxPerRun ?? Number(process.env.LOOMWERK_MAX_PER_RUN ?? 5);
  const temperature = opts.temperature ?? Number(process.env.LOOMWERK_TEMPERATURE ?? 0.8);
  const tasteFloor = opts.tasteFloor ?? Number(process.env.LOOMWERK_TASTE_FLOOR ?? -0.03);
  const tasteMinN = opts.tasteMinN ?? Number(process.env.LOOMWERK_TASTE_MIN_N ?? 20);

  const counts: PulseCounts = { seeds: 0, fresh: 0, created: 0, tasteFiltered: 0, errors: 0 };

  const seeds: Seed[] = [];
  for (const source of sources) {
    try {
      seeds.push(...(await source.detect()));
    } catch (e) {
      counts.errors++;
      console.error(`[pulse] source '${source.name}' failed:`, (e as Error).message);
    }
  }
  counts.seeds = seeds.length;

  // Cheap check before any LLM call: skip seeds that already have a
  // hypothesis. Keys are compared normalized, so dated variants dedupe too.
  const seen = existingSeedKeys(db);
  const fresh = seeds.filter((s) => !seen.has(normalizeSeedKey(s.key)));
  counts.fresh = fresh.length;
  if (!fresh.length) return counts;

  const anti = antiTasteBlock(db);
  const centroids = loadCentroids(db);
  const tasteActive =
    centroids.model !== null && centroids.negative !== null && centroids.negativeN >= tasteMinN;

  for (const seed of fresh) {
    if (counts.created >= maxPerRun) break;
    const op = pickOperator(seed.key);
    let statement: string;
    let rationale: string;
    try {
      const res = await provider.chat(provider.models.cheap, pulsePrompt(seed, op, anti), temperature);
      const obj = extractJson(res.content);
      statement = String(obj.statement ?? '').trim();
      rationale = String(obj.rationale ?? '').trim();
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        console.error('[pulse] budget exhausted — clean stop');
        break;
      }
      counts.errors++;
      console.error(`[pulse] generation failed for ${seed.key}:`, (e as Error).message);
      continue;
    }
    if (!statement) {
      counts.errors++;
      continue;
    }

    // Taste pre-filter (fail-open: any error means "let it through").
    let taste: number | null = null;
    if (tasteActive) {
      try {
        const vec = await provider.embed(provider.models.embed, statement);
        taste =
          (centroids.positive ? cosine(vec, centroids.positive) : 0) -
          (centroids.negative ? cosine(vec, centroids.negative) : 0);
      } catch {
        taste = null;
      }
    }
    const floored = taste !== null && taste < tasteFloor;

    createHypothesis(db, {
      statement,
      rationale,
      seedType: seed.seedType,
      domain: seed.domain,
      variationOp: op,
      status: floored ? 'dismissed' : 'candidate',
      seedRefs: {
        ...seed.refs,
        key: seed.key,
        tension: seed.tension,
        mode: seed.mode,
        ...(seed.topic ? { topic: seed.topic } : {}),
        ...(taste !== null ? { taste_prefilter: Math.round(taste * 1e4) / 1e4 } : {}),
      },
    });
    if (floored) counts.tasteFiltered++;
    else counts.created++;
  }
  return counts;
}
