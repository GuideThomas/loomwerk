// Connector smoke test: markdown pairing incl. index cache, RSS parsing,
// JSONL pattern mining, webhook queue and the registry — no network, no key.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openTestDb } from '../db.js';
import { createMarkdownSource } from '../connectors/markdown.js';
import { parseFeed, pairItems } from '../connectors/rss.js';
import { createJsonlSource, normalizePattern } from '../connectors/jsonl.js';
import { enqueueSeed, webhookSource } from '../connectors/webhook.js';
import { instantiateSource, loadSources } from '../connectors/index.js';
import { runCycle } from '../engine/cycle.js';
import type { Provider } from '../engine/provider.js';

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

// --- controlled embedding space ---------------------------------------------
// Marker words in note bodies map to crafted vectors so cosine similarities
// are exact: FERMENTLOG ↔ SENSORPIECE = 0.72 (inside the 0.64–0.82 band),
// everything else near-orthogonal.
const DIM = 64;
function seededVec(seed: string): number[] {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  const v: number[] = [];
  let x = h >>> 0;
  for (let i = 0; i < DIM; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    v.push(x / 2 ** 32 - 0.5);
  }
  return normalize(v);
}
function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, y) => s + y * y, 0)) || 1;
  return v.map((y) => y / n);
}
const vA = seededVec('anchor-A');
const vOrthBase = (() => {
  const u = seededVec('orthogonal-U');
  const dot = u.reduce((s, y, i) => s + y * vA[i]!, 0);
  return normalize(u.map((y, i) => y - dot * vA[i]!));
})();
const vMid = normalize(vA.map((y, i) => 0.72 * y + Math.sqrt(1 - 0.72 ** 2) * vOrthBase[i]!));

let embedCalls = 0;
const fake: Provider = {
  models: { cheap: 'fake-cheap', judge: 'fake-judge', embed: 'fake-embed' },
  chat(_model, prompt) {
    let content: string;
    if (prompt.includes('strict pre-filter')) content = 'YES';
    else if (prompt.includes('violated_clause'))
      content = JSON.stringify({ violated_clause: '', contradiction: false });
    else if (prompt.includes('Critical innovation panel'))
      content = JSON.stringify({ novelty: 0.7, value: 0.6, feasibility: 0.6, surprise: 0.4, rationale: 'ok' });
    else if (prompt.includes('You deepen'))
      content = JSON.stringify({ statement: 'Next step', rationale: 'r', summary: 's' });
    else content = JSON.stringify({ statement: `Bred idea ${++genCounter}`, rationale: 'r' });
    return Promise.resolve({ content, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  },
  embed(_model, text) {
    embedCalls++;
    if (text.includes('FERMENTLOG')) return Promise.resolve(vA);
    if (text.includes('SENSORPIECE')) return Promise.resolve(vMid);
    return Promise.resolve(seededVec(text));
  },
};
let genCounter = 0;

// --- fixture vault -----------------------------------------------------------
const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'loomwerk-vault-'));
function note(rel: string, body: string): void {
  const abs = path.join(vault, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}
note('kitchen/fermentation-log.md', '---\ntags: [food]\n---\nDaily notes FERMENTLOG about starter temperature and feeding.');
note('electronics/sensor-experiments.md', 'Measurements SENSORPIECE with cheap humidity sensors on the bench.');
note('kitchen/shopping-list.md', 'Flour, salt, olive oil, coffee beans.');
note('archive/old-idea.md', 'This lives in the archive and must be ignored FERMENTLOG.');

const db = openTestDb();
db.prepare("INSERT INTO sources (id, kind, name, config) VALUES (1, 'markdown', 'test-vault', ?)").run(
  JSON.stringify({ path: vault }),
);
const mdSource = createMarkdownSource(1, 'test-vault', { path: vault });

console.log('connector smoke test');

await check('markdown: cross-domain pair inside the similarity band', async () => {
  const seeds = await mdSource.detect({ db, provider: fake });
  assert(seeds.length === 1, `expected exactly 1 seed, got ${seeds.length}`);
  const s = seeds[0]!;
  assert(s.key.startsWith('md:pair:'), 'pair key format');
  assert(s.tension.includes('fermentation-log') || s.tension.includes('Daily notes'), 'tension quotes note A');
  assert(s.tension.includes('cos 0.72'), `tension names the similarity (${s.tension.slice(0, 80)})`);
  assert(s.mode === 'idea', 'markdown seeds run in idea mode');
});

await check('markdown: archive/noise folders are excluded from the index', () => {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM source_index WHERE source_id=1 AND key LIKE 'archive/%'")
    .get() as { n: number };
  assert(row.n === 0, 'archived note must not be indexed');
});

await check('markdown: second run reuses the cached index (no new embeddings)', async () => {
  const before = embedCalls;
  await mdSource.detect({ db, provider: fake });
  assert(embedCalls === before, `expected 0 new embed calls, got ${embedCalls - before}`);
});

await check('markdown: no provider → no seeds, no crash', async () => {
  const seeds = await createMarkdownSource(99, 'no-provider', { path: vault }).detect({ db, provider: null });
  assert(Array.isArray(seeds) && seeds.length === 0, 'degrades to empty');
});

await check('rss: parses RSS and Atom items', () => {
  const rss = `<rss><channel>
    <item><title>Solar panels drop in price</title><link>https://ex.org/a</link><pubDate>${new Date().toUTCString()}</pubDate><description>Costs fall further.</description></item>
    <item><title>City library extends opening hours</title><link>https://ex.org/b</link><pubDate>${new Date().toUTCString()}</pubDate></item>
  </channel></rss>`;
  const atom = `<feed><entry><title>Alpha release shipped</title><link href="https://ex.org/c"/><updated>2026-07-01T00:00:00Z</updated><summary>Notes.</summary></entry></feed>`;
  assert(parseFeed(rss).length === 2, 'two RSS items');
  const atomItems = parseFeed(atom);
  assert(atomItems.length === 1 && atomItems[0]!.link === 'https://ex.org/c', 'atom link from href');
});

await check('rss: pairs distinct items, skips same-story pairs', () => {
  const items = parseFeed(`<rss><channel>
    <item><title>Solar panels drop in price</title><link>https://ex.org/a</link></item>
    <item><title>Solar panels price analysis update</title><link>https://ex.org/a2</link></item>
    <item><title>City library extends opening hours</title><link>https://ex.org/b</link></item>
  </channel></rss>`);
  const seeds = pairItems(items, 'testfeed', { url: 'x' });
  assert(seeds.length === 1, `expected 1 pair, got ${seeds.length}`);
  assert(seeds[0]!.tension.includes('library'), 'paired with the distinct story, not the near-duplicate');
});

await check('jsonl: repeated patterns become setup seeds with FACTS', async () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loomwerk-logs-'));
  const lines: string[] = [];
  for (let i = 0; i < 7; i++) lines.push(JSON.stringify({ message: `timeout after ${i * 13}s connecting upstream` }));
  lines.push(JSON.stringify({ message: 'started ok' }));
  fs.writeFileSync(path.join(logDir, 'app.jsonl'), lines.join('\n'));
  const seeds = await createJsonlSource('applog', { path: logDir, threshold: 5 }).detect({ db, provider: null });
  assert(seeds.length === 1, `expected 1 seed, got ${seeds.length}`);
  assert(seeds[0]!.mode === 'setup', 'jsonl seeds run in setup mode');
  assert(seeds[0]!.tension.includes('FACTS') && seeds[0]!.tension.includes('7×'), 'FACTS carries the count');
  assert(seeds[0]!.tension.includes('NOT:'), 'NOT clause arms the fact gate');
});

await check('jsonl: normalization collapses volatile parts', () => {
  assert(
    normalizePattern('timeout after 31s id=deadbeef99 at 2026-07-19T05:00:00Z') ===
      normalizePattern('timeout after 187s id=cafebabe12 at 2026-07-18T09:30:00Z'),
    'numbers, hex ids and timestamps collapse',
  );
});

await check('webhook: enqueue → drain → consumed', async () => {
  enqueueSeed(db, { key: 'ext:ci:flaky-suite', tension: 'The same test suite failed 4 times this week.', mode: 'setup' });
  const seeds = await webhookSource.detect({ db, provider: null });
  assert(seeds.length === 1 && seeds[0]!.key === 'ext:ci:flaky-suite', 'seed drained');
  const again = await webhookSource.detect({ db, provider: null });
  assert(again.length === 0, 'queue empty after drain');
});

await check('webhook: invalid input rejected', () => {
  let threw = false;
  try {
    enqueueSeed(db, { key: '', tension: '' });
  } catch {
    threw = true;
  }
  assert(threw, 'empty key/tension must throw');
});

await check('registry: instantiates known kinds, skips broken configs', () => {
  assert(instantiateSource({ id: 5, kind: 'rss', name: 'r', config: '{"url":"https://x"}', enabled: 1 }), 'rss ok');
  assert(instantiateSource({ id: 6, kind: 'markdown', name: 'm', config: '{}', enabled: 1 }) === null, 'markdown without path skipped');
  assert(instantiateSource({ id: 7, kind: 'nope', name: 'n', config: '{}', enabled: 1 }) === null, 'unknown kind skipped');
  const sources = loadSources(db);
  assert(sources.some((s) => s.kind === 'markdown'), 'registered vault source loaded');
  assert(sources.some((s) => s.kind === 'webhook'), 'webhook drain always present');
  assert(!sources.some((s) => s.kind === 'demo'), 'demo silent when real sources exist');
});

await check('full cycle breeds from the registered vault source', async () => {
  const summary = await runCycle(db, fake);
  assert(summary.pulse && (summary.pulse.created ?? 0) >= 1, `pulse created ${summary.pulse?.created}`);
  const bred = db
    .prepare("SELECT seed_refs FROM hypotheses WHERE seed_refs LIKE '%md:pair:%'")
    .all();
  assert(bred.length >= 1, 'hypothesis traces back to the markdown pair seed');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
