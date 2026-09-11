import type { Database } from 'better-sqlite3';

import { JETZT_SQL } from '../lib/zeit.js';
// Taste model. The human's decisions are the training signal: statement
// embeddings of loved/promoted/pursued hypotheses form a positive centroid,
// ignored/dismissed ones a negative centroid. A hypothesis' taste score is
// cosine(emb, positive) − cosine(emb, negative): "does this resemble what
// the user picked up, and not what they threw away?"
//
// Deliberately simple geometry — at these volumes (dozens to hundreds of
// decisions) anything fancier would just overfit.

const POSITIVE = ['loved', 'promoted', 'pursued'];
const NEGATIVE = ['ignored', 'dismissed'];

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

function meanVec(vecs: number[][]): number[] {
  const dim = vecs[0]!.length;
  const out = new Array<number>(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) out[i]! += v[i]!;
  for (let i = 0; i < dim; i++) out[i]! /= vecs.length;
  return out;
}

export function upsertEmbedding(db: Database, hypothesisId: number, model: string, vec: number[]): void {
  db.prepare(
    `INSERT INTO embeddings (hypothesis_id, model, dim, vec) VALUES (@id, @model, @dim, @vec)
     ON CONFLICT(hypothesis_id) DO UPDATE SET model=@model, dim=@dim, vec=@vec, created_at=${JETZT_SQL}`,
  ).run({ id: hypothesisId, model, dim: vec.length, vec: JSON.stringify(vec) });
}

export function getEmbedding(db: Database, hypothesisId: number): number[] | null {
  const row = db.prepare('SELECT vec FROM embeddings WHERE hypothesis_id = ?').get(hypothesisId) as
    | { vec: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.vec) as number[];
  } catch {
    return null;
  }
}

/** Hypotheses (active OR decided) that still lack a cached embedding. */
export function missingEmbeddings(db: Database, limit = 200): Array<{ id: number; statement: string }> {
  return db
    .prepare(
      `SELECT h.id, h.statement FROM hypotheses h
       LEFT JOIN embeddings e ON e.hypothesis_id = h.id
       WHERE e.hypothesis_id IS NULL
         AND (h.status IN ('candidate','provocation') OR h.disposition IS NOT NULL)
       ORDER BY h.id DESC LIMIT ?`,
    )
    .all(limit) as Array<{ id: number; statement: string }>;
}

export interface Centroids {
  model: string | null;
  positive: number[] | null;
  negative: number[] | null;
  negativeN: number;
}

export function loadCentroids(db: Database): Centroids {
  const rows = db.prepare('SELECT kind, model, n, vec FROM centroids').all() as Array<{
    kind: string;
    model: string;
    n: number;
    vec: string;
  }>;
  const out: Centroids = { model: null, positive: null, negative: null, negativeN: 0 };
  for (const r of rows) {
    out.model = r.model;
    try {
      const v = JSON.parse(r.vec) as number[];
      if (r.kind === 'positive') out.positive = v;
      else {
        out.negative = v;
        out.negativeN = r.n;
      }
    } catch {
      continue;
    }
  }
  return out;
}

function storeCentroid(db: Database, kind: 'positive' | 'negative', model: string, vecs: number[][]): number[] | null {
  if (!vecs.length) return null;
  const c = meanVec(vecs);
  db.prepare(
    `INSERT INTO centroids (kind, model, n, dim, vec) VALUES (@kind, @model, @n, @dim, @vec)
     ON CONFLICT(kind) DO UPDATE SET model=@model, n=@n, dim=@dim, vec=@vec, updated_at=${JETZT_SQL}`,
  ).run({ kind, model, n: vecs.length, dim: c.length, vec: JSON.stringify(c) });
  return c;
}

export interface TasteResult {
  positive: number;
  negative: number;
  scored: number;
  model: string;
}

/**
 * Recompute both centroids from all decided hypotheses and refresh the taste
 * score of every active one. Idempotent; run after new embeddings land.
 */
export function recomputeTaste(db: Database): TasteResult {
  const tx = db.transaction((): TasteResult => {
    const rows = db
      .prepare(
        `SELECT h.disposition, e.model, e.vec
         FROM hypotheses h JOIN embeddings e ON e.hypothesis_id = h.id
         WHERE h.disposition IS NOT NULL`,
      )
      .all() as Array<{ disposition: string; model: string; vec: string }>;

    const pos: number[][] = [];
    const neg: number[][] = [];
    let model = 'unknown';
    for (const r of rows) {
      let v: number[];
      try {
        v = JSON.parse(r.vec) as number[];
      } catch {
        continue;
      }
      model = r.model || model;
      if (POSITIVE.includes(r.disposition)) pos.push(v);
      else if (NEGATIVE.includes(r.disposition)) neg.push(v);
    }
    const posC = storeCentroid(db, 'positive', model, pos);
    const negC = storeCentroid(db, 'negative', model, neg);

    const active = db
      .prepare("SELECT id FROM hypotheses WHERE status IN ('candidate','provocation')")
      .all() as Array<{ id: number }>;
    let scored = 0;
    for (const { id } of active) {
      const v = getEmbedding(db, id);
      if (!v) continue;
      const taste = (posC ? cosine(v, posC) : 0) - (negC ? cosine(v, negC) : 0);
      db.prepare(`UPDATE hypotheses SET score_taste=?, updated_at=${JETZT_SQL} WHERE id=?`).run(taste, id);
      scored++;
    }
    return { positive: pos.length, negative: neg.length, scored, model };
  });
  return tx();
}
