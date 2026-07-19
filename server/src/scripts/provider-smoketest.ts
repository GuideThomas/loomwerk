// Provider accounting smoke test — the real createOpenAiProvider against a
// monkey-patched fetch, so caps, token sums and both cost sources are
// exercised without any network or key.

import { openTestDb } from '../db.js';
import {
  BudgetExceededError,
  createOpenAiProvider,
  llmDayStats,
  pricingConfigured,
  type ProviderConfig,
} from '../engine/provider.js';
import { finishRun, startRun } from '../lib/runs.js';

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

const baseCfg: ProviderConfig = {
  baseUrl: 'http://fake',
  apiKey: 'test',
  models: { cheap: 'cheap-m', judge: 'judge-m', embed: 'embed-m' },
  dailyRequestCap: 5,
  dailyTokenCap: 0,
  prices: { cheap: null, judge: null, embed: null },
};

// Each test installs the response it wants; the fake echoes it back.
let nextBody: Record<string, unknown> = {};
let nextHeaders: Record<string, string> = {};
globalThis.fetch = (() =>
  Promise.resolve(
    new Response(JSON.stringify(nextBody), {
      status: 200,
      headers: { 'content-type': 'application/json', ...nextHeaders },
    }),
  )) as typeof fetch;

function chatBody(tin: number, tout: number, extraUsage: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    choices: [{ message: { content: 'ok' } }],
    usage: { prompt_tokens: tin, completion_tokens: tout, ...extraUsage },
  };
}

console.log('provider accounting smoke test');

await check('tokens accumulate in the day stats', async () => {
  const db = openTestDb();
  const p = createOpenAiProvider(db, baseCfg);
  nextBody = chatBody(100, 40);
  nextHeaders = {};
  await p.chat('cheap-m', 'x', 0);
  await p.chat('cheap-m', 'x', 0);
  const s = llmDayStats(db);
  assert(s.requests === 2 && s.tokensIn === 200 && s.tokensOut === 80, `got ${JSON.stringify(s)}`);
  assert(s.costMeasured === 0 && s.costPriced === 0, 'no cost without gateway or rates');
});

await check('request cap stops the fifth-plus call', async () => {
  const db = openTestDb();
  const p = createOpenAiProvider(db, { ...baseCfg, dailyRequestCap: 2 });
  nextBody = chatBody(1, 1);
  await p.chat('cheap-m', 'x', 0);
  await p.chat('cheap-m', 'x', 0);
  let threw = false;
  try {
    await p.chat('cheap-m', 'x', 0);
  } catch (e) {
    threw = e instanceof BudgetExceededError;
  }
  assert(threw, 'BudgetExceededError expected');
});

await check('token cap is enforced when configured', async () => {
  const db = openTestDb();
  const p = createOpenAiProvider(db, { ...baseCfg, dailyTokenCap: 150 });
  nextBody = chatBody(100, 60); // 160 tokens after first call
  await p.chat('cheap-m', 'x', 0);
  let threw = false;
  try {
    await p.chat('cheap-m', 'x', 0);
  } catch (e) {
    threw = e instanceof BudgetExceededError;
  }
  assert(threw, 'token cap should trip');
});

await check('gateway cost via response header is measured', async () => {
  const db = openTestDb();
  const p = createOpenAiProvider(db, baseCfg);
  nextBody = chatBody(10, 10);
  nextHeaders = { 'x-litellm-response-cost': '0.00042' };
  await p.chat('cheap-m', 'x', 0);
  const s = llmDayStats(db);
  assert(Math.abs(s.costMeasured - 0.00042) < 1e-9, `measured ${s.costMeasured}`);
  nextHeaders = {};
});

await check('gateway cost via usage.cost is measured', async () => {
  const db = openTestDb();
  const p = createOpenAiProvider(db, baseCfg);
  nextBody = chatBody(10, 10, { cost: 0.0007 });
  await p.chat('cheap-m', 'x', 0);
  assert(Math.abs(llmDayStats(db).costMeasured - 0.0007) < 1e-9, 'usage.cost captured');
});

await check('configured rates price the call when no gateway cost', async () => {
  const db = openTestDb();
  const cfg: ProviderConfig = {
    ...baseCfg,
    prices: { cheap: { in: 0.15, out: 0.6 }, judge: { in: 3, out: 15 }, embed: { in: 0.02 } },
  };
  assert(pricingConfigured(cfg), 'pricing detected');
  const p = createOpenAiProvider(db, cfg);
  nextBody = chatBody(1_000_000, 1_000_000);
  await p.chat('cheap-m', 'x', 0);
  const s = llmDayStats(db);
  assert(Math.abs(s.costPriced - 0.75) < 1e-9, `cheap 1M/1M should price 0.75, got ${s.costPriced}`);
  nextBody = chatBody(1_000_000, 0);
  await p.chat('judge-m', 'x', 0);
  assert(Math.abs(llmDayStats(db).costPriced - 3.75) < 1e-9, 'judge rate applied');
  nextBody = { data: [{ embedding: [0.1, 0.2] }], usage: { prompt_tokens: 1_000_000 } };
  await p.embed('embed-m', 'x');
  assert(Math.abs(llmDayStats(db).costPriced - 3.77) < 1e-9, 'embed rate applied');
});

await check('measured cost wins over configured rates (no double count)', async () => {
  const db = openTestDb();
  const cfg: ProviderConfig = { ...baseCfg, prices: { cheap: { in: 1, out: 1 }, judge: null, embed: null } };
  const p = createOpenAiProvider(db, cfg);
  nextBody = chatBody(1_000_000, 0, { cost: 0.5 });
  await p.chat('cheap-m', 'x', 0);
  const s = llmDayStats(db);
  assert(s.costMeasured === 0.5 && s.costPriced === 0, 'priced must stay 0 when measured exists');
});

await check('run rows carry request/token/cost diffs', async () => {
  const db = openTestDb();
  const cfg: ProviderConfig = { ...baseCfg, prices: { cheap: { in: 1, out: 1 }, judge: null, embed: null } };
  const p = createOpenAiProvider(db, cfg);
  const handle = startRun(db, 'pulse');
  nextBody = chatBody(500_000, 500_000);
  await p.chat('cheap-m', 'x', 0);
  finishRun(db, handle, true, { bred: 1 });
  const row = db.prepare('SELECT llm_requests, tokens_in, tokens_out, cost_usd FROM runs WHERE id=?').get(handle.runId) as {
    llm_requests: number; tokens_in: number; tokens_out: number; cost_usd: number;
  };
  assert(row.llm_requests === 1 && row.tokens_in === 500_000 && row.tokens_out === 500_000, 'diffs recorded');
  assert(Math.abs(row.cost_usd - 1.0) < 1e-9, `cost diff ${row.cost_usd}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
