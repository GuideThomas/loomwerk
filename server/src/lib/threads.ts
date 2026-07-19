import type { Database } from 'better-sqlite3';
import { ApiError, type Hypothesis } from './hypotheses.js';
import { rankScore } from './scoring.js';

// Depth cap, learned the hard way: without it, the first generation of
// threads grew to depth 9 without ever graduating, each step drifting
// further from anything testable. At MAX_DEPTH a thread is 'closed' — ripe,
// verdict due — instead of deepened forever.
export const MAX_THREAD_DEPTH = Number(process.env.LOOMWERK_MAX_THREAD_DEPTH ?? 5);
export const DORMANT_DAYS = Number(process.env.LOOMWERK_THREAD_DORMANT_DAYS ?? 14);

export interface Thread {
  id: number;
  title: string;
  summary: string | null;
  status: 'open' | 'deepening' | 'dormant' | 'closed';
  created_at: string;
  last_deepened_at: string | null;
}

export interface ThreadDetail extends Thread {
  // The maturation chain, oldest first. Depth = chain.length.
  chain: Hypothesis[];
}

export function listThreads(db: Database): Array<Thread & { depth: number }> {
  return db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM hypotheses h WHERE h.thread_id = t.id) AS depth
       FROM threads t
       ORDER BY CASE t.status WHEN 'closed' THEN 0 ELSE 1 END, t.id DESC`,
    )
    .all() as Array<Thread & { depth: number }>;
}

export function getThreadDetail(db: Database, id: number): ThreadDetail {
  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as
    | Thread
    | undefined;
  if (!thread) throw new ApiError(404, `thread ${id} not found`);
  const chain = db
    .prepare('SELECT * FROM hypotheses WHERE thread_id = ? ORDER BY id ASC')
    .all(id) as Hypothesis[];
  return { ...thread, chain };
}

/**
 * Seed new threads from the strongest unattached provocations (by rank —
 * quality plus learned taste). Caps how many new lines open per run so
 * attention doesn't fragment across too many parallel threads.
 */
export function seedThreadsFromSurvivors(db: Database, maxNew = 2): number[] {
  const tx = db.transaction((): number[] => {
    const survivors = db
      .prepare(
        `SELECT * FROM hypotheses
         WHERE status = 'provocation' AND thread_id IS NULL AND score_novelty IS NOT NULL`,
      )
      .all() as Hypothesis[];
    survivors.sort((a, b) => rankScore(b) - rankScore(a) || b.id - a.id);
    const created: number[] = [];
    for (const h of survivors.slice(0, maxNew)) {
      const t = db
        .prepare('INSERT INTO threads (title, summary) VALUES (?, ?)')
        .run(h.statement.slice(0, 120), h.rationale ?? null);
      const threadId = Number(t.lastInsertRowid);
      db.prepare(
        "UPDATE hypotheses SET status='thread', thread_id=?, updated_at=datetime('now') WHERE id=?",
      ).run(threadId, h.id);
      created.push(threadId);
    }
    return created;
  });
  return tx();
}

/** Threads that are due for deepening (open/deepening, below the depth cap). */
export function threadsToDeepen(db: Database, limit = 4): ThreadDetail[] {
  const rows = db
    .prepare(
      `SELECT id FROM threads WHERE status IN ('open','deepening')
       ORDER BY last_deepened_at IS NOT NULL, last_deepened_at ASC, id ASC LIMIT ?`,
    )
    .all(limit) as Array<{ id: number }>;
  return rows.map((r) => getThreadDetail(db, r.id));
}

export interface DeepenInput {
  statement: string;
  rationale?: string;
  summary?: string;
}

/**
 * Append one deepening step to a thread. Enforces the depth cap server-side
 * (the engine checks it too, but the DB layer is the backstop): a thread at
 * MAX_THREAD_DEPTH is concluded instead of extended.
 */
export function deepenThread(db: Database, threadId: number, input: DeepenInput): { hypothesisId?: number; concluded: boolean } {
  const tx = db.transaction((): { hypothesisId?: number; concluded: boolean } => {
    const detail = getThreadDetail(db, threadId);
    if (detail.status === 'closed') return { concluded: true };
    if (detail.chain.length >= MAX_THREAD_DEPTH) {
      concludeThread(db, threadId);
      return { concluded: true };
    }
    const parent = detail.chain[detail.chain.length - 1];
    const res = db
      .prepare(
        `INSERT INTO hypotheses (status, statement, rationale, domain, thread_id, parent_id, created_by, seed_type)
         VALUES ('thread', ?, ?, ?, ?, ?, 'engine', 'deepening')`,
      )
      .run(
        input.statement,
        input.rationale ?? null,
        parent?.domain ?? null,
        threadId,
        parent?.id ?? null,
      );
    db.prepare(
      `UPDATE threads SET status='deepening', summary=COALESCE(?, summary),
         last_deepened_at=datetime('now') WHERE id=?`,
    ).run(input.summary ?? null, threadId);
    // Reaching the cap with this step? Conclude right away — no extra run
    // needed to notice the thread is ripe.
    if (detail.chain.length + 1 >= MAX_THREAD_DEPTH) concludeThread(db, threadId);
    return { hypothesisId: Number(res.lastInsertRowid), concluded: false };
  });
  return tx();
}

/** Mark a thread ripe: no further deepening, a human verdict is due. */
export function concludeThread(db: Database, threadId: number): void {
  db.prepare("UPDATE threads SET status='closed' WHERE id=?").run(threadId);
}

/** Put threads without recent progress to sleep. Returns affected ids. */
export function maintainThreads(db: Database, dormantDays = DORMANT_DAYS): number[] {
  const rows = db
    .prepare(
      `SELECT id FROM threads
       WHERE status IN ('open','deepening')
         AND COALESCE(last_deepened_at, created_at) < datetime('now', ?)`,
    )
    .all(`-${dormantDays} days`) as Array<{ id: number }>;
  for (const { id } of rows) {
    db.prepare("UPDATE threads SET status='dormant' WHERE id=?").run(id);
  }
  return rows.map((r) => r.id);
}
