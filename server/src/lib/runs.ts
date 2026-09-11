import type { Database } from 'better-sqlite3';
import { llmDayStats, type DayStats } from '../engine/provider.js';

import { JETZT_SQL } from '../lib/zeit.js';
// Honest accounting per pipeline stage. Every stage execution leaves a row —
// the run view and the balance sheet are built from this, not estimates.
// Requests, tokens and cost are recorded as day-counter diffs around the
// stage, so they capture exactly what the stage consumed.

export interface RunHandle {
  runId: number;
  before: DayStats;
}

export function startRun(db: Database, stage: string): RunHandle {
  const res = db.prepare('INSERT INTO runs (stage) VALUES (?)').run(stage);
  return { runId: Number(res.lastInsertRowid), before: llmDayStats(db) };
}

export function finishRun(
  db: Database,
  handle: RunHandle,
  ok: boolean,
  counts: Record<string, number>,
  error?: string,
): void {
  const after = llmDayStats(db);
  // A day rollover mid-stage would make diffs negative; clamp to zero
  // rather than corrupt the books.
  const diff = (a: number, b: number) => Math.max(0, a - b);
  const sameDay = after.day === handle.before.day;
  db.prepare(
    `UPDATE runs SET finished_at=${JETZT_SQL}, ok=?, counts=?, llm_requests=?,
       tokens_in=?, tokens_out=?, cost_usd=?, error=? WHERE id=?`,
  ).run(
    ok ? 1 : 0,
    JSON.stringify(counts),
    sameDay ? diff(after.requests, handle.before.requests) : after.requests,
    sameDay ? diff(after.tokensIn, handle.before.tokensIn) : after.tokensIn,
    sameDay ? diff(after.tokensOut, handle.before.tokensOut) : after.tokensOut,
    sameDay
      ? diff(after.costMeasured + after.costPriced, handle.before.costMeasured + handle.before.costPriced)
      : after.costMeasured + after.costPriced,
    error ?? null,
    handle.runId,
  );
}

export function listRuns(db: Database, limit = 50): unknown[] {
  return db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?').all(limit);
}
