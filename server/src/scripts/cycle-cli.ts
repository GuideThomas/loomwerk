// One full cycle from the command line — same code path as the scheduler
// and the API trigger. Useful for cron-less setups and first-run testing:
//
//   LOOMWERK_LLM_BASE_URL=... LOOMWERK_LLM_API_KEY=... npm run cycle

import { getDb } from '../db.js';
import { runCycle } from '../engine/cycle.js';
import { createOpenAiProvider, providerConfigFromEnv } from '../engine/provider.js';

const cfg = providerConfigFromEnv();
if (!cfg) {
  console.error('no LLM provider configured — set LOOMWERK_LLM_BASE_URL and LOOMWERK_LLM_API_KEY');
  process.exit(1);
}

const db = getDb();
console.log(`cycle starting (models: ${cfg.models.cheap} / ${cfg.models.judge} / ${cfg.models.embed})`);
const summary = await runCycle(db, createOpenAiProvider(db, cfg));
for (const [stageName, counts] of Object.entries(summary)) {
  console.log(`  ${stageName}: ${counts ? JSON.stringify(counts) : 'FAILED'}`);
}
