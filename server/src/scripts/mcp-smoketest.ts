// MCP smoke test — client and server linked in-memory, no stdio, no network.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openTestDb } from '../db.js';
import { createHypothesis } from '../lib/hypotheses.js';
import { buildMcpServer } from '../mcp/server.js';

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

const db = openTestDb();
const server = buildMcpServer(db, '0.0.0-test');
const client = new Client({ name: 'smoketest', version: '0.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);

function textOf(res: unknown): string {
  const content = (res as { content: Array<{ type: string; text: string }> }).content;
  return content.map((c) => c.text).join('\n');
}

console.log('mcp smoke test');

await check('exposes the six tools', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert(
    JSON.stringify(names) ===
      JSON.stringify(['get_balance', 'ingest_seed', 'list_provocations', 'list_threads', 'react', 'run_cycle']),
    `unexpected tool set: ${names.join(', ')}`,
  );
});

await check('ingest_seed queues a tension', async () => {
  const res = await client.callTool({
    name: 'ingest_seed',
    arguments: {
      key: 'mcp:test:tension',
      tension: 'Two systems disagree about the same number every night at 03:00.',
      mode: 'setup',
    },
  });
  assert(textOf(res).includes('"queued": true'), 'queued');
  const row = db.prepare('SELECT COUNT(*) AS n FROM pending_seeds').get() as { n: number };
  assert(row.n === 1, 'pending seed persisted');
});

await check('ingest_seed rejects thin input', async () => {
  const res = (await client.callTool({
    name: 'ingest_seed',
    arguments: { key: 'x', tension: 'too short' },
  })) as { isError?: boolean };
  assert(res.isError, 'schema validation should fail');
});

await check('list_provocations + react round-trip', async () => {
  const h = createHypothesis(db, { statement: 'MCP round-trip provocation', status: 'provocation' });
  const list = await client.callTool({ name: 'list_provocations', arguments: {} });
  assert(textOf(list).includes('MCP round-trip provocation'), 'provocation listed');
  const res = await client.callTool({
    name: 'react',
    arguments: { id: h.id, signal: 'promoted' },
  });
  assert(textOf(res).includes('"actionId"'), 'promotion returns the action id');
  const status = (db.prepare('SELECT status FROM hypotheses WHERE id=?').get(h.id) as { status: string }).status;
  assert(status === 'promoted', 'promoted in the database');
});

await check('dismissal reason lands in the disposition trail', async () => {
  const h = createHypothesis(db, { statement: 'MCP dismissal target', status: 'provocation' });
  await client.callTool({
    name: 'react',
    arguments: { id: h.id, signal: 'dismissed', note: 'not on our roadmap' },
  });
  const note = (
    db.prepare('SELECT note, actor FROM dispositions WHERE hypothesis_id=? ORDER BY id DESC').get(h.id) as {
      note: string;
      actor: string;
    }
  );
  assert(note.note === 'not on our roadmap' && note.actor === 'human', 'reason + human actor recorded');
});

await check('get_balance returns the computed report', async () => {
  const res = await client.callTool({ name: 'get_balance', arguments: {} });
  assert(textOf(res).includes('"categories"'), 'categories present');
});

await check('run_cycle without a provider fails gracefully', async () => {
  const res = await client.callTool({ name: 'run_cycle', arguments: {} });
  assert(textOf(res).includes('no LLM provider configured'), 'clear error, no crash');
});

await client.close();
await server.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
