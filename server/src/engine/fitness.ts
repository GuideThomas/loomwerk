import type { Database } from 'better-sqlite3';
import { missingEmbeddings, recomputeTaste, upsertEmbedding } from '../lib/taste.js';
import { BudgetExceededError, type Provider } from './provider.js';

// Stage 4 — fitness (taste learning). Embed what's new, then re-average the
// centroids from all human decisions and refresh active taste scores.

export interface FitnessCounts extends Record<string, number> {
  embedded: number;
  positive: number;
  negative: number;
  scored: number;
  errors: number;
}

export async function runFitness(db: Database, provider: Provider): Promise<FitnessCounts> {
  const counts: FitnessCounts = { embedded: 0, positive: 0, negative: 0, scored: 0, errors: 0 };

  for (const { id, statement } of missingEmbeddings(db)) {
    try {
      const vec = await provider.embed(provider.models.embed, statement);
      upsertEmbedding(db, id, provider.models.embed, vec);
      counts.embedded++;
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        console.error('[fitness] budget exhausted — clean stop');
        break;
      }
      counts.errors++;
    }
  }

  const res = recomputeTaste(db);
  counts.positive = res.positive;
  counts.negative = res.negative;
  counts.scored = res.scored;
  return counts;
}
