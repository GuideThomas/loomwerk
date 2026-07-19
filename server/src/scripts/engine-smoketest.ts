// Engine smoke test — the full pipeline against a deterministic fake
// provider (no network, no key). This is the fast half of the phase-1 gate;
// the slow half is a manual cycle against a real endpoint.

import { openTestDb } from '../db.js';
import { createHypothesis, reactToHypothesis } from '../lib/hypotheses.js';
import { scoreHypothesis, selectElites } from '../lib/scoring.js';
import { recomputeTaste, upsertEmbedding } from '../lib/taste.js';
import { deepenThread, getThreadDetail, MAX_THREAD_DEPTH } from '../lib/threads.js';
import { runCycle } from '../engine/cycle.js';
import { runCritic } from '../engine/critic.js';
import { antiTasteBlock } from '../engine/pulse.js';
import { normalizeSeedKey, demoSource } from '../engine/seeds.js';
import { extractJson, type Provider } from '../engine/provider.js';

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok   ${name}`);
    })
    .catch((e: Error) => {
      failed++;
      console.error(`  FAIL ${name}: ${e.message}`);
    });
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// Deterministic hash-seeded embedding with signed components: identical
// text → identical vector (cos 1), different texts → near-orthogonal
// (cos ≈ 0 ± 0.13 at 64 dims). That keeps the duplicate gate honest in
// tests: only real repeats cross the 0.88 threshold.
function fakeVec(text: string): number[] {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  const v: number[] = [];
  let x = h >>> 0;
  for (let i = 0; i < 64; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    v.push(x / 2 ** 32 - 0.5);
  }
  const norm = Math.sqrt(v.reduce((s, y) => s + y * y, 0)) || 1;
  return v.map((y) => y / norm);
}

let genCounter = 0;
const fake: Provider = {
  models: { cheap: 'fake-cheap', judge: 'fake-judge', embed: 'fake-embed' },
  chat(_model, prompt) {
    let content: string;
    if (prompt.includes('strict pre-filter')) {
      content = 'YES';
    } else if (prompt.includes('violated_clause')) {
      content = JSON.stringify({ violated_clause: '', contradiction: false });
    } else if (prompt.includes('Critical innovation panel')) {
      // The magic word "moonshot" gets a feasibility below the floor.
      const feasibility = prompt.includes('moonshot') ? 0.1 : 0.6;
      content = JSON.stringify({
        novelty: 0.8, value: 0.7, feasibility, surprise: 0.5, rationale: 'fake verdict',
      });
    } else if (prompt.includes('You deepen')) {
      content = JSON.stringify({
        statement: `Deeper step ${++genCounter}`,
        rationale: 'fake deepening',
        summary: 'fake essence',
      });
    } else {
      // pulse generation
      content = JSON.stringify({
        statement: `Fake idea ${++genCounter} bridging the observed tension`,
        rationale: 'fake rationale with a cheap first test',
      });
    }
    return Promise.resolve({
      content,
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
  },
  embed(_model, text) {
    return Promise.resolve(fakeVec(text));
  },
};

const db = openTestDb();

console.log('engine smoke test');

await check('seed keys normalize volatile parts', () => {
  assert(
    normalizeSeedKey('hygiene:backlog-2026-07-18') === normalizeSeedKey('hygiene:backlog-2026-07-19'),
    'dates should not create new keys',
  );
  assert(
    normalizeSeedKey('spend:1234567') === normalizeSeedKey('spend:7654321'),
    'large numbers should not create new keys',
  );
});

await check('extractJson survives fenced output', () => {
  const obj = extractJson('```json\n{"a": 1}\n```');
  assert(obj.a === 1, 'fenced JSON parsed');
});

let firstCycleElites = 0;
await check('full cycle: pulse → critic → fitness → weave', async () => {
  const summary = await runCycle(db, fake, [demoSource]);
  assert(summary.pulse && summary.pulse.created === 3, `pulse created ${summary.pulse?.created}, expected 3`);
  assert(summary.critic && summary.critic.judged === 3, `judged ${summary.critic?.judged}, expected 3`);
  assert((summary.critic.elites ?? 0) >= 2, `elites ${summary.critic.elites}, expected >= 2`);
  firstCycleElites = summary.critic.elites ?? 0;
  assert(summary.fitness && (summary.fitness.embedded ?? 0) >= 3, 'fitness embedded the new statements');
  assert(summary.weave && summary.weave.seeded === 2, `weave seeded ${summary.weave?.seeded}, expected 2`);
  assert((summary.weave.deepened ?? 0) >= 1, 'at least one thread deepened');
  const runs = db.prepare('SELECT stage, ok FROM runs ORDER BY id').all() as Array<{ stage: string; ok: number }>;
  assert(runs.length === 4 && runs.every((r) => r.ok === 1), 'four ok run rows recorded');
});

await check('second cycle is idempotent on seeds (dedup)', async () => {
  const summary = await runCycle(db, fake, [demoSource]);
  assert(summary.pulse && summary.pulse.fresh === 0, `expected 0 fresh seeds, got ${summary.pulse?.fresh}`);
  assert(summary.pulse.created === 0, 'no duplicate hypotheses bred');
});

await check('duplicate gate kills near-identical candidates', async () => {
  const existing = db
    .prepare("SELECT statement FROM hypotheses WHERE status IN ('provocation','thread') LIMIT 1")
    .get() as { statement: string };
  const dupe = createHypothesis(db, { statement: existing.statement, status: 'candidate' });
  const counts = await runCritic(db, fake);
  assert(counts.duplicates === 1, `expected 1 duplicate, got ${counts.duplicates}`);
  const row = db.prepare('SELECT status FROM hypotheses WHERE id=?').get(dupe.id) as { status: string };
  assert(row.status === 'dismissed', 'duplicate dismissed');
  const note = db
    .prepare('SELECT note FROM dispositions WHERE hypothesis_id=? ORDER BY id DESC')
    .get(dupe.id) as { note: string };
  assert(note.note.includes('Duplicate gate'), 'dismissal note names the gate');
});

await check('feasibility floor kills moonshots but keeps the score', async () => {
  const moon = createHypothesis(db, {
    statement: 'A moonshot requiring a research lab and years of work',
    status: 'candidate',
  });
  const counts = await runCritic(db, fake);
  assert(counts.floored === 1, `expected 1 floored, got ${counts.floored}`);
  const row = db
    .prepare('SELECT status, score_feasibility FROM hypotheses WHERE id=?')
    .get(moon.id) as { status: string; score_feasibility: number };
  assert(row.status === 'dismissed', 'moonshot dismissed');
  assert(row.score_feasibility === 0.1, 'score kept for the taste model');
});

await check('MAP-elites: same niche → one winner, loser dismissed', () => {
  const a = createHypothesis(db, {
    statement: 'Niche contender A', status: 'candidate', domain: 'nichetest', variationOp: 'inversion',
  });
  const b = createHypothesis(db, {
    statement: 'Niche contender B', status: 'candidate', domain: 'nichetest', variationOp: 'inversion',
  });
  scoreHypothesis(db, a.id, { novelty: 0.9, value: 0.8, feasibility: 0.7, surprise: 0.6 });
  scoreHypothesis(db, b.id, { novelty: 0.3, value: 0.3, feasibility: 0.7, surprise: 0.2 });
  selectElites(db);
  const sa = (db.prepare('SELECT status FROM hypotheses WHERE id=?').get(a.id) as { status: string }).status;
  const sb = (db.prepare('SELECT status FROM hypotheses WHERE id=?').get(b.id) as { status: string }).status;
  assert(sa === 'provocation', `winner should be provocation, is ${sa}`);
  assert(sb === 'dismissed', `loser should be dismissed, is ${sb}`);
});

await check('taste centroids learn from decisions and score actives', () => {
  const loved = createHypothesis(db, { statement: 'Loved topic alpha', status: 'provocation' });
  const hated = createHypothesis(db, { statement: 'Zzz boring topic omega', status: 'provocation' });
  reactToHypothesis(db, loved.id, 'loved');
  reactToHypothesis(db, hated.id, 'ignored');
  upsertEmbedding(db, loved.id, 'fake-embed', fakeVec('Loved topic alpha'));
  upsertEmbedding(db, hated.id, 'fake-embed', fakeVec('Zzz boring topic omega'));
  const similar = createHypothesis(db, { statement: 'Loved topic alpha variant', status: 'candidate' });
  upsertEmbedding(db, similar.id, 'fake-embed', fakeVec('Loved topic alpha'));
  const res = recomputeTaste(db);
  assert(res.positive >= 1 && res.negative >= 1, 'both centroids exist');
  const taste = (db.prepare('SELECT score_taste FROM hypotheses WHERE id=?').get(similar.id) as {
    score_taste: number;
  }).score_taste;
  assert(taste > 0, `similar-to-loved should score positive, got ${taste}`);
});

await check('anti-taste block reflects human dismissal reasons', () => {
  const h = createHypothesis(db, { statement: 'Yet another dashboard idea', status: 'provocation' });
  reactToHypothesis(db, h.id, 'dismissed', 'human', 'dashboards never get looked at');
  const block = antiTasteBlock(db);
  assert(block.includes('dashboards never get looked at'), 'reason appears in the prompt block');
  assert(block.includes('ANTI-TASTE'), 'block is labeled');
});

await check(`depth cap concludes threads at ${MAX_THREAD_DEPTH}`, () => {
  const h = createHypothesis(db, { statement: 'Thread root for cap test', status: 'provocation' });
  const { threadId } = reactToHypothesis(db, h.id, 'pursued');
  assert(threadId, 'thread created');
  for (let i = 0; i < MAX_THREAD_DEPTH + 2; i++) {
    deepenThread(db, threadId!, { statement: `Cap step ${i}` });
  }
  const detail = getThreadDetail(db, threadId!);
  assert(detail.status === 'closed', `thread should be closed, is ${detail.status}`);
  assert(detail.chain.length <= MAX_THREAD_DEPTH, `chain capped at ${MAX_THREAD_DEPTH}, is ${detail.chain.length}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// keep firstCycleElites referenced (documentation value in output)
void firstCycleElites;
