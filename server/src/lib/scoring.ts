import type { Database } from 'better-sqlite3';

import { NOW_SQL } from '../lib/time.js';
// Selection stage: critic scores + MAP-elites quality-diversity.
//
// The point of MAP-elites here: don't keep the N best ideas overall (they
// converge on one theme), keep the best idea PER NICHE (domain × operator,
// optionally × topic). That preserves a diverse front of survivors.

export interface Scores {
  novelty: number;
  value: number;
  feasibility: number;
  surprise: number;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, Number(n) || 0));

// Weighted composite: innovation (novelty/surprise) counts, but value and
// feasibility keep it grounded — a surprising but useless idea doesn't win.
const WEIGHTS = { novelty: 0.35, value: 0.3, feasibility: 0.2, surprise: 0.15 };

export function compositeScore(h: {
  score_novelty?: number | null;
  score_value?: number | null;
  score_feasibility?: number | null;
  score_surprise?: number | null;
}): number {
  return (
    WEIGHTS.novelty * (h.score_novelty ?? 0) +
    WEIGHTS.value * (h.score_value ?? 0) +
    WEIGHTS.feasibility * (h.score_feasibility ?? 0) +
    WEIGHTS.surprise * (h.score_surprise ?? 0)
  );
}

// Learned taste tilts the ranking but must not dominate content quality:
// composite is in [0,1], taste roughly in [-0.3, 0.3] — small tilt factor.
const TASTE_WEIGHT = 0.25;

export function rankScore(
  h: Parameters<typeof compositeScore>[0] & { score_taste?: number | null },
): number {
  return compositeScore(h) + TASTE_WEIGHT * (h.score_taste ?? 0);
}

/**
 * Persist the critic panel's verdict. Sets the four score columns and the
 * MAP-elites niche. Status stays untouched — promotion/dismissal happens in
 * selectElites() as a second, atomic step.
 */
export function scoreHypothesis(db: Database, id: number, scores: Scores): void {
  const h = db.prepare('SELECT domain, variation_op, seed_refs FROM hypotheses WHERE id = ?').get(id) as
    | { domain: string | null; variation_op: string | null; seed_refs: string | null }
    | undefined;
  if (!h) throw new Error(`hypothesis ${id} not found`);
  // Niche = domain × operator, plus the seed topic when present — so only
  // ideas about the same theme compete, and one hot topic cannot crowd out
  // every other niche.
  let topic = '';
  if (h.seed_refs) {
    try {
      const refs = JSON.parse(h.seed_refs) as { topic?: string };
      if (refs.topic?.trim()) topic = `/${refs.topic.trim()}`;
    } catch {
      // refs not JSON → no topic
    }
  }
  const niche = `${h.domain ?? 'unknown'}${topic}:${h.variation_op ?? 'none'}`;
  db.prepare(
    `UPDATE hypotheses SET score_novelty=@nov, score_value=@val, score_feasibility=@fea,
       score_surprise=@sur, niche=@niche, updated_at=${NOW_SQL} WHERE id=@id`,
  ).run({
    id,
    niche,
    nov: clamp01(scores.novelty),
    val: clamp01(scores.value),
    fea: clamp01(scores.feasibility),
    sur: clamp01(scores.surprise),
  });
}

export interface EliteResult {
  niches: number;
  elites: number[];
  dismissed: number[];
}

/**
 * MAP-elites selection: per niche only the strongest scored hypothesis
 * survives and becomes a 'provocation'; the rest of the niche is dismissed.
 * Only scored candidate/provocation rows compete — human decisions
 * (promoted/thread/dismissed) are never touched. Stable across runs: an
 * existing elite competes again against new candidates and keeps its niche
 * unless something stronger arrives. Machine dismissal writes NO disposition
 * (no taste signal — that belongs to the human).
 */
export function selectElites(db: Database): EliteResult {
  const tx = db.transaction((): EliteResult => {
    const scored = db
      .prepare(
        `SELECT id, niche, status, score_novelty, score_value, score_feasibility, score_surprise, score_taste
         FROM hypotheses
         WHERE status IN ('candidate','provocation') AND niche IS NOT NULL AND score_novelty IS NOT NULL`,
      )
      .all() as Array<{
      id: number;
      niche: string;
      status: string;
      score_novelty: number;
      score_value: number;
      score_feasibility: number;
      score_surprise: number;
      score_taste: number | null;
    }>;

    const byNiche = new Map<string, typeof scored>();
    for (const h of scored) {
      const group = byNiche.get(h.niche);
      if (group) group.push(h);
      else byNiche.set(h.niche, [h]);
    }

    const elites: number[] = [];
    const dismissed: number[] = [];
    for (const [, group] of byNiche) {
      group.sort((a, b) => rankScore(b) - rankScore(a) || b.id - a.id);
      const winner = group[0]!;
      if (winner.status !== 'provocation') {
        db.prepare(`UPDATE hypotheses SET status='provocation', updated_at=${NOW_SQL} WHERE id=?`).run(
          winner.id,
        );
      }
      elites.push(winner.id);
      for (const loser of group.slice(1)) {
        if (loser.status !== 'dismissed') {
          db.prepare(`UPDATE hypotheses SET status='dismissed', updated_at=${NOW_SQL} WHERE id=?`).run(
            loser.id,
          );
        }
        dismissed.push(loser.id);
      }
    }
    return { niches: byNiche.size, elites, dismissed };
  });
  return tx();
}
