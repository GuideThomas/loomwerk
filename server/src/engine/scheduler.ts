import type { Database } from 'better-sqlite3';
import { runCycle } from './cycle.js';
import { createOpenAiProvider, providerConfigFromEnv } from './provider.js';

import { JETZT_SQL, tagInWien } from '../lib/zeit.js';
// Built-in daily scheduler — no system cron needed. Set LOOMWERK_CYCLE_HOUR
// (0-23, local time) to run one full cycle per day; leave it unset to
// trigger cycles manually via the API. The last-run day is persisted so a
// restart within the same day doesn't double-run.

export function startScheduler(db: Database): void {
  const hourRaw = process.env.LOOMWERK_CYCLE_HOUR;
  if (hourRaw === undefined || hourRaw === '') return;
  const hour = Number(hourRaw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    console.error(`[scheduler] invalid LOOMWERK_CYCLE_HOUR '${hourRaw}' — scheduler disabled`);
    return;
  }
  console.log(`[scheduler] daily cycle at ${String(hour).padStart(2, '0')}:00 local time`);

  const timer = setInterval(() => {
    void tick(db, hour);
  }, 60_000);
  // Never keep the process alive just for the timer.
  timer.unref();
}

let running = false;

async function tick(db: Database, hour: number): Promise<void> {
  if (running) return;
  const now = new Date();
  if (now.getHours() !== hour) return;
  // Wiener Tag, nicht UTC-Tag: die Zeile darueber prueft mit getHours() die
  // ORTS-Stunde. Mit einem UTC-Tagesschluessel liefen beide zwischen 00:00
  // und 02:00 auseinander — der Lauf haette sich auf den Vortag gebucht.
  const today = tagInWien(now);
  const last = db.prepare("SELECT value FROM settings WHERE key='cycle.lastRunDay'").get() as
    | { value: string }
    | undefined;
  if (last?.value === today) return;

  const cfg = providerConfigFromEnv();
  if (!cfg) {
    console.error('[scheduler] no LLM provider configured (LOOMWERK_LLM_BASE_URL/_API_KEY) — skipping cycle');
    return;
  }
  running = true;
  try {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('cycle.lastRunDay', @v)
       ON CONFLICT(key) DO UPDATE SET value=@v, updated_at=${JETZT_SQL}`,
    ).run({ v: today });
    const summary = await runCycle(db, createOpenAiProvider(db, cfg));
    console.log('[scheduler] cycle done:', JSON.stringify(summary));
  } catch (e) {
    console.error('[scheduler] cycle failed:', (e as Error).message);
  } finally {
    running = false;
  }
}
