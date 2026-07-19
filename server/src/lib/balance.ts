import type { Database } from 'better-sqlite3';

// The balance sheet: every hypothesis ever bred, sorted into one category
// with a fixed precedence. Honest accounting is a product feature — success
// is rare by design, so we measure the culling, not the volume.
//
// Precedence: win → nugget → refuted → duplicate → gate → culled → open.

export type BalanceCategory =
  | 'win'
  | 'nugget'
  | 'refuted'
  | 'duplicate'
  | 'gate'
  | 'culled'
  | 'open';

export interface BalanceReport {
  total: number;
  categories: Record<BalanceCategory, number>;
  successRate: number; // wins / total
  nuggetRate: number;  // (wins + nuggets) / total
  llmRequests: number; // lifetime, from run accounting
  tokensIn: number;    // lifetime prompt tokens
  tokensOut: number;   // lifetime completion tokens
  costUsd: number;     // lifetime — gateway-measured and/or rate-priced
  cycles: number;      // distinct run days
}

export function getBalance(db: Database): BalanceReport {
  const rows = db
    .prepare(
      `SELECT h.id, h.status, h.disposition, h.win_note, h.grounding_note,
              (SELECT note FROM dispositions d
                WHERE d.hypothesis_id = h.id AND d.signal = 'dismissed'
                ORDER BY d.id DESC LIMIT 1) AS dismiss_note
       FROM hypotheses h`,
    )
    .all() as Array<{
    id: number;
    status: string;
    disposition: string | null;
    win_note: string | null;
    grounding_note: string | null;
    dismiss_note: string | null;
  }>;

  const categories: Record<BalanceCategory, number> = {
    win: 0, nugget: 0, refuted: 0, duplicate: 0, gate: 0, culled: 0, open: 0,
  };

  for (const h of rows) {
    categories[categorize(h)]++;
  }

  const runs = db
    .prepare(
      `SELECT COALESCE(SUM(llm_requests),0) AS req, COALESCE(SUM(cost_usd),0) AS cost,
              COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout,
              COUNT(DISTINCT date(started_at)) AS days
       FROM runs`,
    )
    .get() as { req: number; cost: number; tin: number; tout: number; days: number };

  const total = rows.length;
  return {
    total,
    categories,
    successRate: total ? categories.win / total : 0,
    nuggetRate: total ? (categories.win + categories.nugget) / total : 0,
    llmRequests: runs.req,
    tokensIn: runs.tin,
    tokensOut: runs.tout,
    costUsd: runs.cost,
    cycles: runs.days,
  };
}

function categorize(h: {
  status: string;
  disposition: string | null;
  win_note: string | null;
  grounding_note: string | null;
  dismiss_note: string | null;
}): BalanceCategory {
  // A win is a loved outcome; a curated win_note on anything else is a
  // nugget (e.g. the idea was refuted but the measurement stuck around).
  if (h.disposition === 'loved') return 'win';
  if (h.win_note) return 'nugget';
  // "…, 0 refuted" contains the word without meaning it — strip zero counts
  // before testing, only a real refutation lands in the category.
  if (h.grounding_note && /refut|widerlegt/i.test(h.grounding_note.replace(/\b0\s+(refuted|widerlegt)\b/gi, ''))) {
    return 'refuted';
  }
  const note = h.dismiss_note ?? '';
  if (note.startsWith('Duplicate gate')) return 'duplicate';
  if (note.startsWith('Fact gate') || note.startsWith('Feasibility floor')) return 'gate';
  if (h.status === 'dismissed') return 'culled';
  return 'open';
}
