import type { Database } from 'better-sqlite3';
import { finishRun, startRun } from '../lib/runs.js';
import { runCritic } from './critic.js';
import { runFitness } from './fitness.js';
import { runPulse } from './pulse.js';
import { runWeave } from './weave.js';
import type { Provider } from './provider.js';
import { demoSource, type SeedSource } from './seeds.js';

// One full daily cycle: pulse → critic → fitness → weave. Each stage is
// recorded as a run row regardless of outcome — the balance sheet depends
// on honest accounting, including failures.

export interface CycleSummary {
  pulse: Record<string, number> | null;
  critic: Record<string, number> | null;
  fitness: Record<string, number> | null;
  weave: Record<string, number> | null;
}

async function stage<T extends Record<string, number>>(
  db: Database,
  name: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const handle = startRun(db, name);
  try {
    const counts = await fn();
    finishRun(db, handle, true, counts);
    return counts;
  } catch (e) {
    finishRun(db, handle, false, {}, (e as Error).message);
    console.error(`[cycle] stage '${name}' failed:`, (e as Error).message);
    return null;
  }
}

export async function runCycle(
  db: Database,
  provider: Provider,
  sources?: SeedSource[],
): Promise<CycleSummary> {
  const activeSources = sources ?? defaultSources();
  return {
    pulse: await stage(db, 'pulse', () => runPulse(db, provider, activeSources)),
    critic: await stage(db, 'critic', () => runCritic(db, provider)),
    fitness: await stage(db, 'fitness', () => runFitness(db, provider)),
    weave: await stage(db, 'weave', () => runWeave(db, provider)),
  };
}

// Until real connectors land, the demo source keeps the cycle experiencable.
// It is only active when explicitly enabled or when no source is configured.
export function defaultSources(): SeedSource[] {
  if (process.env.LOOMWERK_DEMO_SEEDS === '0') return [];
  return [demoSource];
}
