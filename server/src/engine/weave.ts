import type { Database } from 'better-sqlite3';
import {
  MAX_THREAD_DEPTH,
  concludeThread,
  deepenThread,
  maintainThreads,
  seedThreadsFromSurvivors,
  threadsToDeepen,
} from '../lib/threads.js';
import { BudgetExceededError, extractJson, type Provider } from './provider.js';
import { deepenPrompt } from './prompts.js';

// Stage 5 — weave (accumulation). The strongest provocations become
// persistent threads; each run deepens them by exactly one concrete step.
// This is what separates an innovator from a task runner: surviving ideas
// compound over weeks instead of being one-off sparks.

export interface WeaveCounts extends Record<string, number> {
  seeded: number;
  deepened: number;
  concluded: number;
  dormant: number;
  errors: number;
}

function threadMode(db: Database, threadId: number): 'setup' | 'idea' {
  const row = db
    .prepare('SELECT seed_refs FROM hypotheses WHERE thread_id = ? ORDER BY id ASC LIMIT 1')
    .get(threadId) as { seed_refs: string | null } | undefined;
  if (row?.seed_refs) {
    try {
      const refs = JSON.parse(row.seed_refs) as { mode?: string };
      if (refs.mode === 'setup') return 'setup';
    } catch {
      // fall through
    }
  }
  return 'idea';
}

export async function runWeave(
  db: Database,
  provider: Provider,
  opts: { maxNewThreads?: number; maxDeepen?: number } = {},
): Promise<WeaveCounts> {
  const maxNew = opts.maxNewThreads ?? Number(process.env.LOOMWERK_THREAD_SEED_MAX ?? 2);
  const maxDeepen = opts.maxDeepen ?? Number(process.env.LOOMWERK_MAX_DEEPEN ?? 4);
  const counts: WeaveCounts = { seeded: 0, deepened: 0, concluded: 0, dormant: 0, errors: 0 };

  counts.seeded = seedThreadsFromSurvivors(db, maxNew).length;

  for (const thread of threadsToDeepen(db, maxDeepen)) {
    // Depth cap BEFORE the LLM call — a ripe thread costs nothing to close.
    if (thread.chain.length >= MAX_THREAD_DEPTH) {
      concludeThread(db, thread.id);
      counts.concluded++;
      continue;
    }
    const mode = threadMode(db, thread.id);
    const steps = thread.chain.map((h) => h.statement);
    const prompt = deepenPrompt(mode, thread.title, steps);

    let obj: Record<string, unknown> | null = null;
    const models = [provider.models.judge];
    if (provider.models.cheap !== provider.models.judge) models.push(provider.models.cheap);
    outer: for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await provider.chat(model, prompt, 0.7);
          obj = extractJson(res.content);
          break outer;
        } catch (e) {
          if (e instanceof BudgetExceededError) {
            console.error('[weave] budget exhausted — clean stop');
            return counts;
          }
          if (attempt === 0) continue;
        }
      }
    }
    if (!obj || !String(obj.statement ?? '').trim()) {
      counts.errors++;
      continue;
    }
    const result = deepenThread(db, thread.id, {
      statement: String(obj.statement).trim(),
      rationale: String(obj.rationale ?? '').trim() || undefined,
      summary: String(obj.summary ?? '').trim() || undefined,
    });
    if (result.concluded) counts.concluded++;
    else counts.deepened++;
  }

  counts.dormant = maintainThreads(db).length;
  return counts;
}
