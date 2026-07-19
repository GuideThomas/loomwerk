import type { Database } from 'better-sqlite3';
import { ApiError, type Hypothesis } from './hypotheses.js';

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
