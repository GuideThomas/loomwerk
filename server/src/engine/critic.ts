import type { Database } from 'better-sqlite3';
import { reactToHypothesis, type Hypothesis } from '../lib/hypotheses.js';
import { scoreHypothesis, selectElites, type EliteResult } from '../lib/scoring.js';
import { cosine, getEmbedding, upsertEmbedding } from '../lib/taste.js';
import { BudgetExceededError, extractJson, type Provider } from './provider.js';
import { factcheckPrompt, judgePrompt, prescreenPrompt } from './prompts.js';

// Stage 2+3 — critic panel + quality-diversity selection. Cost-aware in the
// same spirit as the whole engine: the expensive judge model only ever sees
// survivors of three cheap gates.
//
//   1. pre-screen (cheap): is this a real, testable hypothesis at all?
//   2. fact gate (cheap): does it contradict the seed's verified facts?
//      Only fires when the seed actually carries FACTS/NOT clauses.
//   3. duplicate gate (embeddings): near-identical to an existing hypothesis
//      — including RECENTLY CLOSED ones. Comparing only against open rows
//      was a production bug: dismissed ideas came back like echoes the
//      moment their original left the stage.
//   4. judge (judge tier): 4 scores, strict calibration.
//   5. feasibility floor: moonshots die regardless of novelty. The score is
//      kept — the taste model learns from the negative.
//   6. MAP-elites (no LLM): best per niche survives.

export interface CriticOptions {
  maxJudge?: number;
  dupThreshold?: number;
  dupMaxOpen?: number;
  dupMaxClosed?: number;
  dupClosedWindowDays?: number;
  feasibilityFloor?: number;
}

export interface CriticCounts extends Record<string, number> {
  candidates: number;
  judged: number;
  prescreened: number;
  factGated: number;
  duplicates: number;
  floored: number;
  elites: number;
  niches: number;
  errors: number;
}

function seedTension(h: Hypothesis): string {
  if (!h.seed_refs) return '';
  try {
    const refs = JSON.parse(h.seed_refs) as { tension?: string };
    return refs.tension ?? '';
  } catch {
    return '';
  }
}

function seedMode(h: Hypothesis): 'setup' | 'idea' {
  if (h.seed_refs) {
    try {
      const refs = JSON.parse(h.seed_refs) as { mode?: string };
      if (refs.mode === 'setup') return 'setup';
    } catch {
      // fall through
    }
  }
  return 'idea';
}

async function prescreen(provider: Provider, h: Hypothesis): Promise<boolean> {
  const res = await provider.chat(provider.models.cheap, prescreenPrompt(h.statement, h.rationale), 0);
  // Models decorate one-word answers ("**YES**", "Yes."). Compare letters only
  // — the raw startsWith check once silently rejected 100% of candidates.
  const letters = res.content.toUpperCase().replace(/[^A-Z]/g, '');
  return letters.startsWith('YES') || letters.startsWith('JA');
}

async function factcheck(provider: Provider, h: Hypothesis): Promise<'CONTRADICTS' | 'GROUNDED' | 'SKIP'> {
  const tension = seedTension(h);
  if (!tension.includes('FACTS') && !tension.includes('NOT:')) return 'SKIP';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await provider.chat(
        provider.models.cheap,
        factcheckPrompt(tension, h.statement, h.rationale),
        0,
      );
      const obj = extractJson(res.content);
      const quote = String(obj.violated_clause ?? '').trim();
      // A contradiction only counts with a nameable, non-trivial violated
      // clause — this gate kills ideas, so precision beats recall.
      if (obj.contradiction === true && quote.length >= 8) return 'CONTRADICTS';
      return 'GROUNDED';
    } catch (e) {
      if (e instanceof BudgetExceededError) throw e;
      if (attempt === 0) continue;
    }
  }
  return 'GROUNDED'; // unverifiable → don't kill, the judge decides
}

interface DupEntry {
  id: number;
  status: string;
  vec: number[];
}

async function buildDupIndex(db: Database, provider: Provider, opts: Required<Pick<CriticOptions, 'dupMaxOpen' | 'dupMaxClosed' | 'dupClosedWindowDays'>>): Promise<DupEntry[]> {
  const open = db
    .prepare(
      `SELECT id, statement, status FROM hypotheses
       WHERE status IN ('provocation','promoted') ORDER BY id DESC LIMIT ?`,
    )
    .all(opts.dupMaxOpen) as Array<{ id: number; statement: string; status: string }>;
  const closed = db
    .prepare(
      `SELECT id, statement, status FROM hypotheses
       WHERE status IN ('dismissed','thread')
         AND updated_at >= datetime('now', ?)
       ORDER BY id DESC LIMIT ?`,
    )
    .all(`-${opts.dupClosedWindowDays} days`, opts.dupMaxClosed) as Array<{
    id: number;
    statement: string;
    status: string;
  }>;

  const index: DupEntry[] = [];
  for (const h of [...open, ...closed]) {
    try {
      // Reuse cached embeddings; only embed what the fitness stage hasn't
      // seen yet (and cache it, so the cost is paid once).
      let vec = getEmbedding(db, h.id);
      if (!vec) {
        vec = await provider.embed(provider.models.embed, h.statement);
        upsertEmbedding(db, h.id, provider.models.embed, vec);
      }
      index.push({ id: h.id, status: h.status, vec });
    } catch (e) {
      if (e instanceof BudgetExceededError) throw e;
      // single embedding failure: skip entry, gate stays partially active
    }
  }
  return index;
}

export async function runCritic(
  db: Database,
  provider: Provider,
  opts: CriticOptions = {},
): Promise<CriticCounts> {
  const maxJudge = opts.maxJudge ?? Number(process.env.LOOMWERK_MAX_JUDGE ?? 12);
  const dupThreshold = opts.dupThreshold ?? Number(process.env.LOOMWERK_DUP_THRESHOLD ?? 0.88);
  const feasibilityFloor = opts.feasibilityFloor ?? Number(process.env.LOOMWERK_FEASIBILITY_FLOOR ?? 0.25);
  const dupOpts = {
    dupMaxOpen: opts.dupMaxOpen ?? 40,
    dupMaxClosed: opts.dupMaxClosed ?? 40,
    dupClosedWindowDays: opts.dupClosedWindowDays ?? 45,
  };

  const counts: CriticCounts = {
    candidates: 0, judged: 0, prescreened: 0, factGated: 0,
    duplicates: 0, floored: 0, elites: 0, niches: 0, errors: 0,
  };

  const candidates = db
    .prepare("SELECT * FROM hypotheses WHERE status = 'candidate' ORDER BY id ASC")
    .all() as Hypothesis[];
  counts.candidates = candidates.length;
  if (!candidates.length) return counts;

  let dupIndex: DupEntry[] = [];
  try {
    dupIndex = await buildDupIndex(db, provider, dupOpts);
  } catch (e) {
    if (e instanceof BudgetExceededError) return counts;
    // fail-open: gate inactive
  }

  for (const h of candidates) {
    if (counts.judged >= maxJudge) break;
    try {
      if (!(await prescreen(provider, h))) {
        counts.prescreened++;
        continue; // stays candidate; a later run may catch a transient miss
      }

      if ((await factcheck(provider, h)) === 'CONTRADICTS') {
        counts.factGated++;
        reactToHypothesis(db, h.id, 'dismissed', 'engine',
          'Fact gate: hypothesis contradicts the verified facts of its seed.');
        continue;
      }

      if (dupIndex.length) {
        const vec = await provider.embed(provider.models.embed, h.statement);
        upsertEmbedding(db, h.id, provider.models.embed, vec);
        let best: DupEntry | null = null;
        let bestSim = 0;
        for (const entry of dupIndex) {
          if (entry.id === h.id) continue;
          const sim = cosine(vec, entry.vec);
          if (sim > bestSim) {
            bestSim = sim;
            best = entry;
          }
        }
        if (best && bestSim >= dupThreshold) {
          counts.duplicates++;
          reactToHypothesis(db, h.id, 'dismissed', 'engine',
            `Duplicate gate: near-identical to hypothesis #${best.id} [${best.status}] (cos ${bestSim.toFixed(2)}).`);
          continue;
        }
      }

      // Judge — with model cascade and one retry: small models occasionally
      // return empty or fenced output on structured tasks.
      const prompt = judgePrompt(seedMode(h), h.statement, h.rationale);
      let scores: { novelty: number; value: number; feasibility: number; surprise: number } | null = null;
      const models = [provider.models.judge];
      if (provider.models.cheap !== provider.models.judge) models.push(provider.models.cheap);
      outer: for (const model of models) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await provider.chat(model, prompt, 0.3);
            const obj = extractJson(res.content);
            scores = {
              novelty: Number(obj.novelty ?? 0),
              value: Number(obj.value ?? 0),
              feasibility: Number(obj.feasibility ?? 0),
              surprise: Number(obj.surprise ?? 0),
            };
            break outer;
          } catch (e) {
            if (e instanceof BudgetExceededError) throw e;
            if (attempt === 0) continue;
          }
        }
      }
      if (!scores) {
        counts.errors++;
        continue;
      }
      scoreHypothesis(db, h.id, scores);
      counts.judged++;

      if (scores.feasibility < feasibilityFloor) {
        counts.floored++;
        reactToHypothesis(db, h.id, 'dismissed', 'engine',
          `Feasibility floor: ${scores.feasibility.toFixed(2)} < ${feasibilityFloor} — not testable with the operator's means (moonshot), dismissed regardless of novelty.`);
      }
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        console.error('[critic] budget exhausted — clean stop');
        break;
      }
      counts.errors++;
      console.error(`[critic] error on #${h.id}:`, (e as Error).message);
    }
  }

  let result: EliteResult = { niches: 0, elites: [], dismissed: [] };
  if (counts.judged > 0) result = selectElites(db);
  counts.elites = result.elites.length;
  counts.niches = result.niches;
  return counts;
}
