// Run seed detection only — no hypotheses are bred, nothing is judged.
// Useful to preview what a configured source would feed into the engine:
//
//   LOOMWERK_LLM_BASE_URL=... LOOMWERK_LLM_API_KEY=... npm run detect

import { getDb } from '../db.js';
import { loadSources } from '../connectors/index.js';
import { createOpenAiProvider, providerConfigFromEnv } from '../engine/provider.js';

const db = getDb();
const cfg = providerConfigFromEnv();
const provider = cfg ? createOpenAiProvider(db, cfg) : null;
if (!provider) console.log('note: no LLM provider configured — embedding-based sources will yield nothing');

for (const source of loadSources(db)) {
  const seeds = await source.detect({ db, provider });
  console.log(`\n[${source.kind}] ${source.name}: ${seeds.length} seed(s)`);
  for (const s of seeds) {
    console.log(`  · ${s.key} (${s.seedType}/${s.domain}, ${s.mode})`);
    console.log(`    ${s.tension.replace(/\n/g, '\n    ').slice(0, 400)}`);
  }
}
