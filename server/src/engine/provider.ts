import type { Database } from 'better-sqlite3';

// LLM access. One deliberate constraint: everything speaks the OpenAI wire
// format, so any compatible endpoint works — OpenAI, a local Ollama, an
// OpenRouter key, or a self-hosted gateway. No provider SDKs.
//
// Three model tiers, because cost discipline is a design pillar:
//   cheap  — variation + pre-screening (high volume, low stakes)
//   judge  — scoring + thread deepening (low volume, needs quality)
//   embed  — duplicate gate + taste model

export interface ChatResult {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface Provider {
  chat(model: string, prompt: string, temperature: number): Promise<ChatResult>;
  embed(model: string, text: string): Promise<number[]>;
  models: { cheap: string; judge: string; embed: string };
}

export class BudgetExceededError extends Error {
  constructor(msg = 'daily LLM budget exhausted') {
    super(msg);
  }
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  models: { cheap: string; judge: string; embed: string };
  dailyRequestCap: number;
}

export function providerConfigFromEnv(): ProviderConfig | null {
  const baseUrl = process.env.LOOMWERK_LLM_BASE_URL;
  const apiKey = process.env.LOOMWERK_LLM_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey,
    models: {
      cheap: process.env.LOOMWERK_MODEL_CHEAP ?? 'gpt-4o-mini',
      judge: process.env.LOOMWERK_MODEL_JUDGE ?? process.env.LOOMWERK_MODEL_CHEAP ?? 'gpt-4o-mini',
      embed: process.env.LOOMWERK_MODEL_EMBED ?? 'text-embedding-3-small',
    },
    // Hard daily cap on LLM requests. A stuck loop should cost cents, not a
    // monthly budget — the engine stops cleanly when the cap is reached.
    dailyRequestCap: Number(process.env.LOOMWERK_DAILY_LLM_REQUESTS ?? 300),
  };
}

// Request counter, persisted per UTC day in the settings table. Checked
// before every call so the cap holds across stages and restarts.
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function llmRequestsToday(db: Database): number {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'llm.requests'").get() as
    | { value: string }
    | undefined;
  if (!row) return 0;
  try {
    const parsed = JSON.parse(row.value) as { day: string; n: number };
    return parsed.day === today() ? parsed.n : 0;
  } catch {
    return 0;
  }
}

function bumpRequestCounter(db: Database): void {
  const n = llmRequestsToday(db) + 1;
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('llm.requests', @v)
     ON CONFLICT(key) DO UPDATE SET value = @v, updated_at = datetime('now')`,
  ).run({ v: JSON.stringify({ day: today(), n }) });
}

export function createOpenAiProvider(db: Database, cfg: ProviderConfig): Provider {
  async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
    if (llmRequestsToday(db) >= cfg.dailyRequestCap) {
      throw new BudgetExceededError(`daily cap of ${cfg.dailyRequestCap} LLM requests reached`);
    }
    bumpRequestCounter(db);
    const res = await fetch(cfg.baseUrl + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      // Upstream budget/rate limit — treat exactly like our own cap: stop, don't retry.
      throw new BudgetExceededError('provider returned 429');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`provider ${path} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  return {
    models: cfg.models,
    async chat(model, prompt, temperature) {
      const res = (await post('/chat/completions', {
        model,
        temperature,
        messages: [{ role: 'user', content: prompt }],
      })) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const content = res.choices?.[0]?.message?.content?.trim() ?? '';
      const u = res.usage ?? {};
      return {
        content,
        usage: {
          prompt_tokens: u.prompt_tokens ?? 0,
          completion_tokens: u.completion_tokens ?? 0,
          total_tokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
        },
      };
    },
    async embed(model, text) {
      const res = (await post('/embeddings', {
        model,
        input: text.slice(0, 2000),
        // Some embedding backends (e.g. Mistral behind a gateway) reject
        // requests without an explicit encoding format.
        encoding_format: 'float',
      })) as { data?: Array<{ embedding?: number[] }> };
      const vec = res.data?.[0]?.embedding;
      if (!Array.isArray(vec) || vec.length === 0) throw new Error('empty embedding');
      return vec;
    },
  };
}

// Models love to wrap JSON in ``` fences or prose. Extract the outermost
// object instead of trusting the raw string.
export function extractJson(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in response');
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}
