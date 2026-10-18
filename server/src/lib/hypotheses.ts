import type { Database } from 'better-sqlite3';

import { NOW_SQL } from '../lib/time.js';
// Hypothesis lifecycle service.
//
// Two invariants that everything else depends on:
//  1. Human decisions are final. The engine may append signals, but it never
//     overrides a disposition set by a human.
//  2. The disposition trail is append-only — it is the training signal for
//     the taste model, so history must stay intact.

export type HypothesisStatus =
  | 'seed'
  | 'candidate'
  | 'provocation'
  | 'thread'
  | 'promoted'
  | 'dismissed';

export type Signal = 'promoted' | 'pursued' | 'ignored' | 'dismissed' | 'loved';
export type Actor = 'human' | 'engine';

export interface Hypothesis {
  id: number;
  status: HypothesisStatus;
  seed_type: string | null;
  seed_refs: string | null;
  variation_op: string | null;
  domain: string | null;
  source_id: number | null;
  statement: string;
  rationale: string | null;
  score_novelty: number | null;
  score_value: number | null;
  score_feasibility: number | null;
  score_surprise: number | null;
  score_taste: number | null;
  niche: string | null;
  thread_id: number | null;
  parent_id: number | null;
  disposition: Signal | null;
  disposition_at: string | null;
  promoted_action_id: number | null;
  grounding_note: string | null;
  win_note: string | null;
  created_by: Actor;
  created_at: string;
  updated_at: string;
}

export interface CreateInput {
  statement: string;
  rationale?: string;
  seedType?: string;
  seedRefs?: unknown;
  variationOp?: string;
  domain?: string;
  sourceId?: number;
  createdBy?: Actor;
  // Engine output enters as 'candidate' and has to survive the critic.
  // Humans may drop an idea straight into the inbox as 'provocation'.
  // 'dismissed' is used by the taste pre-filter: clearly-rejected material is
  // still recorded (dedup ledger, audit) but never reaches critic or inbox.
  status?: 'candidate' | 'provocation' | 'dismissed';
}

export function createHypothesis(db: Database, input: CreateInput): Hypothesis {
  const statement = input.statement?.trim();
  if (!statement) throw new ApiError(400, 'statement is required');
  const status = input.status ?? 'candidate';
  const createdBy = input.createdBy ?? 'engine';
  const res = db
    .prepare(
      `INSERT INTO hypotheses
         (status, seed_type, seed_refs, variation_op, domain, source_id,
          statement, rationale, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      status,
      input.seedType ?? null,
      input.seedRefs != null ? JSON.stringify(input.seedRefs) : null,
      input.variationOp ?? null,
      input.domain ?? null,
      input.sourceId ?? null,
      statement,
      input.rationale ?? null,
      createdBy,
    );
  return getHypothesis(db, Number(res.lastInsertRowid));
}

export function getHypothesis(db: Database, id: number): Hypothesis {
  const row = db.prepare('SELECT * FROM hypotheses WHERE id = ?').get(id) as
    | Hypothesis
    | undefined;
  if (!row) throw new ApiError(404, `hypothesis ${id} not found`);
  return row;
}

export interface ListFilter {
  status?: HypothesisStatus;
  domain?: string;
  wins?: boolean;
  limit?: number;
}

export function listHypotheses(db: Database, filter: ListFilter = {}): Hypothesis[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    where.push('status = ?');
    params.push(filter.status);
  }
  if (filter.domain) {
    where.push('domain = ?');
    params.push(filter.domain);
  }
  if (filter.wins) {
    // A "win" is either a loved outcome or a curated win note — the latter
    // also catches indirect wins (idea refuted, but a nugget was extracted).
    where.push("(disposition = 'loved' OR win_note IS NOT NULL)");
  }
  const limit = Math.min(filter.limit ?? 200, 1000);
  const sql = `SELECT * FROM hypotheses
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id DESC LIMIT ?`;
  return db.prepare(sql).all(...params, limit) as Hypothesis[];
}

export interface ReactResult {
  hypothesis: Hypothesis;
  actionId?: number;
  threadId?: number;
}

// The single write path for decisions. Runs in one transaction so that a
// promote can never leave a half-created action behind.
export function reactToHypothesis(
  db: Database,
  id: number,
  signal: Signal,
  actor: Actor = 'human',
  note?: string,
): ReactResult {
  const tx = db.transaction((): ReactResult => {
    const hyp = getHypothesis(db, id);

    // Invariant 1: the engine never overturns a human verdict.
    if (actor === 'engine' && hyp.disposition && hasHumanDisposition(db, id)) {
      throw new ApiError(409, `hypothesis ${id} already decided by a human`);
    }

    // Idempotency: promoting twice returns the existing action.
    if (signal === 'promoted' && hyp.status === 'promoted' && hyp.promoted_action_id) {
      return { hypothesis: hyp, actionId: hyp.promoted_action_id };
    }

    recordDisposition(db, id, signal, actor, note);

    let actionId: number | undefined;
    let threadId: number | undefined;
    switch (signal) {
      case 'promoted': {
        const action = db
          .prepare(
            `INSERT INTO actions (hypothesis_id, title, body)
             VALUES (?, ?, ?)`,
          )
          .run(id, actionTitle(hyp), actionBody(hyp));
        actionId = Number(action.lastInsertRowid);
        db.prepare(
          `UPDATE hypotheses SET status='promoted', promoted_action_id=?,
             disposition='promoted', disposition_at=${NOW_SQL},
             updated_at=${NOW_SQL} WHERE id=?`,
        ).run(actionId, id);
        break;
      }
      case 'pursued': {
        // Pursue = open (or join) a long-running thread.
        if (hyp.thread_id) {
          threadId = hyp.thread_id;
        } else {
          const t = db
            .prepare('INSERT INTO threads (title, summary) VALUES (?, ?)')
            .run(threadTitle(hyp), hyp.rationale ?? null);
          threadId = Number(t.lastInsertRowid);
        }
        db.prepare(
          `UPDATE hypotheses SET status='thread', thread_id=?,
             disposition='pursued', disposition_at=${NOW_SQL},
             updated_at=${NOW_SQL} WHERE id=?`,
        ).run(threadId, id);
        break;
      }
      case 'dismissed': {
        db.prepare(
          `UPDATE hypotheses SET status='dismissed',
             disposition='dismissed', disposition_at=${NOW_SQL},
             updated_at=${NOW_SQL} WHERE id=?`,
        ).run(id);
        break;
      }
      case 'loved':
      case 'ignored': {
        // Pure taste signals — the hypothesis keeps its place in the funnel.
        db.prepare(
          `UPDATE hypotheses SET disposition=?, disposition_at=${NOW_SQL},
             updated_at=${NOW_SQL} WHERE id=?`,
        ).run(signal, id);
        break;
      }
    }
    return { hypothesis: getHypothesis(db, id), actionId, threadId };
  });
  return tx();
}

export function setWinNote(db: Database, id: number, winNote: string | null): Hypothesis {
  getHypothesis(db, id); // 404 check
  db.prepare(
    `UPDATE hypotheses SET win_note=?, updated_at=${NOW_SQL} WHERE id=?`,
  ).run(winNote, id);
  return getHypothesis(db, id);
}

function hasHumanDisposition(db: Database, id: number): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM dispositions WHERE hypothesis_id=? AND actor='human' LIMIT 1",
    )
    .get(id);
  return row != null;
}

function recordDisposition(
  db: Database,
  id: number,
  signal: Signal,
  actor: Actor,
  note?: string,
): void {
  db.prepare(
    'INSERT INTO dispositions (hypothesis_id, signal, actor, note) VALUES (?, ?, ?, ?)',
  ).run(id, signal, actor, note ?? null);
}

function actionTitle(hyp: Hypothesis): string {
  const s = hyp.statement.replace(/\s+/g, ' ').trim();
  return s.length > 90 ? s.slice(0, 87) + '…' : s;
}

function actionBody(hyp: Hypothesis): string {
  const parts = [`From provocation #${hyp.id} (${hyp.domain ?? 'no domain'})`];
  if (hyp.rationale) parts.push('', hyp.rationale);
  if (hyp.grounding_note) parts.push('', `Pre-grounding: ${hyp.grounding_note}`);
  return parts.join('\n');
}

function threadTitle(hyp: Hypothesis): string {
  return actionTitle(hyp);
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
