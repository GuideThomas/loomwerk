import type { Database } from 'better-sqlite3';
import { llmRequestsToday } from '../engine/provider.js';

// Honest accounting per pipeline stage. Every stage execution leaves a row —
// the run view and the balance sheet are built from this, not estimates.

export function startRun(db: Database, stage: string): { runId: number; llmBefore: number } {
  const res = db.prepare('INSERT INTO runs (stage) VALUES (?)').run(stage);
  return { runId: Number(res.lastInsertRowid), llmBefore: llmRequestsToday(db) };
}

export function finishRun(
  db: Database,
  handle: { runId: number; llmBefore: number },
  ok: boolean,
  counts: Record<string, number>,
  error?: string,
): void {
  db.prepare(
    `UPDATE runs SET finished_at=datetime('now'), ok=?, counts=?, llm_requests=?, error=? WHERE id=?`,
  ).run(
    ok ? 1 : 0,
    JSON.stringify(counts),
    Math.max(0, llmRequestsToday(db) - handle.llmBefore),
    error ?? null,
    handle.runId,
  );
}

export function listRuns(db: Database, limit = 50): unknown[] {
  return db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?').all(limit);
}
