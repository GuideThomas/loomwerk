import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Database } from 'better-sqlite3';
import { listHypotheses, reactToHypothesis, type Signal } from '../lib/hypotheses.js';
import { listThreads } from '../lib/threads.js';
import { getBalance } from '../lib/balance.js';
import { enqueueSeed } from '../connectors/webhook.js';
import { runCycle } from '../engine/cycle.js';
import { createOpenAiProvider, providerConfigFromEnv } from '../engine/provider.js';

// MCP surface: lets Claude (or any MCP client) feed the engine and harvest
// provocations from inside a conversation. Deliberately the same semantics
// as the UI — reactions arrive as 'human' because an assistant acting on
// the user's explicit instruction carries their intent, and the engine's
// no-override invariant still protects earlier human decisions.
//
// SQLite in WAL mode is safe to share between the app server and this
// process; both go through the same migration-checked handle.

function json(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function buildMcpServer(db: Database, version: string): McpServer {
  const server = new McpServer({ name: 'loomwerk', version });

  server.registerTool(
    'ingest_seed',
    {
      description:
        'Push an observed tension into Loomwerk. The next cycle breeds a hypothesis from it. ' +
        'Use a stable key (no dates/counters — it drives dedup). Quote real material in the ' +
        'tension; mark verified facts with FACTS:/NOT: lines to arm the fact gate. ' +
        "mode 'setup' keeps ideas on the user's own stack, 'idea' allows outward-facing ones.",
      inputSchema: {
        key: z.string().min(3).describe('Stable identifier, e.g. "ci:flaky-auth-suite"'),
        tension: z.string().min(20).describe('The observed tension, quoting real material'),
        mode: z.enum(['setup', 'idea']).optional(),
        domain: z.string().optional().describe('Niche bucket, defaults to "external"'),
        topic: z.string().optional(),
      },
    },
    ({ key, tension, mode, domain, topic }) => {
      const id = enqueueSeed(db, { key, tension, mode, domain, topic, seedType: 'mcp' });
      return json({ queued: true, id, note: 'bred on the next cycle' });
    },
  );

  server.registerTool(
    'list_provocations',
    {
      description:
        'List open provocations — ideas that survived the critic gates and await a human ' +
        'verdict. Scores are 0..1 (novelty/value/feasibility/surprise); taste is the learned ' +
        "fit with the user's past decisions.",
      inputSchema: {},
    },
    () => {
      const rows = listHypotheses(db, { status: 'provocation' }).map((h) => ({
        id: h.id,
        statement: h.statement,
        rationale: h.rationale,
        niche: h.niche ?? h.domain,
        scores: {
          novelty: h.score_novelty,
          value: h.score_value,
          feasibility: h.score_feasibility,
          surprise: h.score_surprise,
        },
        taste: h.score_taste,
        grounding: h.grounding_note,
      }));
      return json(rows);
    },
  );

  server.registerTool(
    'react',
    {
      description:
        'Record the user\'s verdict on a provocation. Only do this when the user has actually ' +
        "decided — reactions train the taste model. 'promoted' creates an action record, " +
        "'pursued' opens a thread, 'dismissed' should carry the user's reason (it becomes a " +
        "negative instruction for future breeding), 'loved'/'ignored' are pure taste signals.",
      inputSchema: {
        id: z.number().int().positive(),
        signal: z.enum(['promoted', 'pursued', 'ignored', 'dismissed', 'loved']),
        note: z.string().optional().describe('For dismissals: the user\'s reason'),
      },
    },
    ({ id, signal, note }) => {
      const result = reactToHypothesis(db, id, signal as Signal, 'human', note);
      return json({
        status: result.hypothesis.status,
        actionId: result.actionId,
        threadId: result.threadId,
      });
    },
  );

  server.registerTool(
    'list_threads',
    {
      description:
        'List idea threads — surviving lines that mature across cycles. status "closed" means ' +
        'ripe: the thread hit its depth cap and a human verdict is due.',
      inputSchema: {},
    },
    () => json(listThreads(db)),
  );

  server.registerTool(
    'get_balance',
    {
      description:
        'The honest self-audit: every hypothesis ever bred, by category, plus success/nugget ' +
        'rates and real LLM accounting. Computed, never estimated.',
      inputSchema: {},
    },
    () => json(getBalance(db)),
  );

  server.registerTool(
    'run_cycle',
    {
      description:
        'Run one full pipeline cycle (pulse → critic → fitness → weave). Requires a configured ' +
        'LLM provider; may take a few minutes and spends real tokens within the daily cap.',
      inputSchema: {},
    },
    async () => {
      const cfg = providerConfigFromEnv();
      if (!cfg) {
        return json({ error: 'no LLM provider configured (LOOMWERK_LLM_BASE_URL / LOOMWERK_LLM_API_KEY)' });
      }
      const summary = await runCycle(db, createOpenAiProvider(db, cfg));
      return json(summary);
    },
  );

  return server;
}
