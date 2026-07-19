// Lifecycle smoke test — runs against an in-memory database, no server
// needed. This is the phase-0 gate: the full hypothesis lifecycle has to be
// playable end to end before any engine code lands on top.

import { openTestDb } from '../db.js';
import {
  createHypothesis,
  getHypothesis,
  listHypotheses,
  reactToHypothesis,
  setWinNote,
} from '../lib/hypotheses.js';
import { getThreadDetail, listThreads } from '../lib/threads.js';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL ${name}: ${(e as Error).message}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const db = openTestDb();

console.log('lifecycle smoke test');

check('engine creates a candidate', () => {
  const h = createHypothesis(db, {
    statement: 'Combine the newsletter digest with the stale-notes report',
    rationale: 'Both surface neglected knowledge; the overlap might be a feature.',
    seedType: 'cross_domain',
    variationOp: 'combination',
    domain: 'demo',
  });
  assert(h.status === 'candidate', `status is ${h.status}`);
  assert(h.created_by === 'engine', 'created_by');
});

check('human creates a provocation directly', () => {
  const h = createHypothesis(db, {
    statement: 'What if the weekly review wrote itself from the disposition trail?',
    createdBy: 'human',
    status: 'provocation',
  });
  assert(h.status === 'provocation', `status is ${h.status}`);
});

check('empty statement is rejected', () => {
  let threw = false;
  try {
    createHypothesis(db, { statement: '   ' });
  } catch {
    threw = true;
  }
  assert(threw, 'expected a 400');
});

check('promote creates exactly one action (idempotent)', () => {
  const h = createHypothesis(db, { statement: 'Promote me', status: 'provocation' });
  const r1 = reactToHypothesis(db, h.id, 'promoted');
  assert(r1.hypothesis.status === 'promoted', 'status after promote');
  assert(r1.actionId, 'action created');
  const r2 = reactToHypothesis(db, h.id, 'promoted');
  assert(r2.actionId === r1.actionId, 'second promote reuses the action');
  const actions = db
    .prepare('SELECT COUNT(*) AS n FROM actions WHERE hypothesis_id=?')
    .get(h.id) as { n: number };
  assert(actions.n === 1, `expected 1 action, got ${actions.n}`);
});

check('pursue opens a thread and attaches the hypothesis', () => {
  const h = createHypothesis(db, { statement: 'Pursue me', status: 'provocation' });
  const r = reactToHypothesis(db, h.id, 'pursued');
  assert(r.threadId, 'thread created');
  const detail = getThreadDetail(db, r.threadId!);
  assert(detail.chain.length === 1 && detail.chain[0]!.id === h.id, 'chain contains hypothesis');
  assert(listThreads(db).some((t) => t.id === r.threadId), 'thread listed');
});

check('love keeps the hypothesis in place', () => {
  const h = createHypothesis(db, { statement: 'Love me', status: 'provocation' });
  const r = reactToHypothesis(db, h.id, 'loved');
  assert(r.hypothesis.status === 'provocation', 'status unchanged');
  assert(r.hypothesis.disposition === 'loved', 'disposition recorded');
});

check('dismiss archives the hypothesis', () => {
  const h = createHypothesis(db, { statement: 'Dismiss me', status: 'provocation' });
  const r = reactToHypothesis(db, h.id, 'dismissed', 'human', 'not our scale');
  assert(r.hypothesis.status === 'dismissed', 'status');
  const trail = db
    .prepare('SELECT note FROM dispositions WHERE hypothesis_id=? ORDER BY id DESC')
    .get(h.id) as { note: string | null };
  assert(trail.note === 'not our scale', 'dismissal reason kept for the anti-taste model');
});

check('engine cannot overturn a human decision', () => {
  const h = createHypothesis(db, { statement: 'Human decided', status: 'provocation' });
  reactToHypothesis(db, h.id, 'loved', 'human');
  let threw = false;
  try {
    reactToHypothesis(db, h.id, 'dismissed', 'engine');
  } catch {
    threw = true;
  }
  assert(threw, 'engine override must be rejected');
  assert(getHypothesis(db, h.id).disposition === 'loved', 'human verdict intact');
});

check('disposition trail is append-only across signals', () => {
  const h = createHypothesis(db, { statement: 'Trail me', status: 'provocation' });
  reactToHypothesis(db, h.id, 'loved');
  reactToHypothesis(db, h.id, 'promoted');
  const n = (
    db.prepare('SELECT COUNT(*) AS n FROM dispositions WHERE hypothesis_id=?').get(h.id) as {
      n: number;
    }
  ).n;
  assert(n === 2, `expected 2 trail entries, got ${n}`);
});

check('wins filter catches loved and curated nuggets', () => {
  const loved = createHypothesis(db, { statement: 'A win', status: 'provocation' });
  reactToHypothesis(db, loved.id, 'loved');
  const nugget = createHypothesis(db, { statement: 'Refuted but useful', status: 'provocation' });
  reactToHypothesis(db, nugget.id, 'dismissed');
  setWinNote(db, nugget.id, 'Refuted the premise, but the measurement became a daily check.');
  const wins = listHypotheses(db, { wins: true }).map((h) => h.id);
  assert(wins.includes(loved.id), 'loved counted');
  assert(wins.includes(nugget.id), 'nugget counted');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
