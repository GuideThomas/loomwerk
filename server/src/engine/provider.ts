import type { Database } from 'better-sqlite3';

import { NOW_SQL, localDay } from '../lib/time.js';
// LLM access. One deliberate constraint: everything speaks the OpenAI wire
// format, so any compatible endpoint works — OpenAI, a local Ollama, an
// OpenRouter key, or a self-hosted gateway. No provider SDKs.
//
// Three model tiers, because cost discipline is a design pillar:
//   cheap  — variation + pre-screening (high volume, low stakes)
//   judge  — scoring + thread deepening (low volume, needs quality)
//   embed  — duplicate gate + taste model
//
// Accounting (v0.3): tokens are the universal currency — every endpoint
// reports usage, no endpoint reports prices. Dollar cost is recorded from
// two honest sources only:
//   measured — a gateway that returns real cost with the response
//              (OpenRouter's usage.cost, LiteLLM's response header)
//   priced   — computed from user-configured $/1M rates per tier
// Never both for the same call; never a built-in price guess.

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

export interface TierPrices {
  // USD per 1M tokens; null = not configured
  cheap: { in: number; out: number } | null;
  judge: { in: number; out: number } | null;
  embed: { in: number } | null;
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  models: { cheap: string; judge: string; embed: string };
  dailyRequestCap: number;
  dailyTokenCap: number; // 0 = off
  prices: TierPrices;
}

function parsePricePair(raw: string | undefined): { in: number; out: number } | null {
  if (!raw) return null;
  const parts = raw.split(',').map((s) => Number(s.trim()));
  const a = parts[0] ?? NaN;
  const b = parts[1] ?? NaN;
  if (!Number.isFinite(a) || a < 0) return null;
  return { in: a, out: Number.isFinite(b) && b >= 0 ? b : a };
}

export function providerConfigFromEnv(): ProviderConfig | null {
  const baseUrl = process.env.LOOMWERK_LLM_BASE_URL;
  const apiKey = process.env.LOOMWERK_LLM_API_KEY;
  if (!baseUrl || !apiKey) return null;
  const embedPrice = Number(process.env.LOOMWERK_PRICE_EMBED);
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey,
    models: {
      cheap: process.env.LOOMWERK_MODEL_CHEAP ?? 'gpt-4o-mini',
      judge: process.env.LOOMWERK_MODEL_JUDGE ?? process.env.LOOMWERK_MODEL_CHEAP ?? 'gpt-4o-mini',
      embed: process.env.LOOMWERK_MODEL_EMBED ?? 'text-embedding-3-small',
    },
    // Hard daily caps. A stuck loop should cost cents, not a monthly
    // budget — the engine stops cleanly when a cap is reached. The request
    // cap always applies; the token cap is opt-in and guards against
    // single huge prompts slipping under a request count.
    dailyRequestCap: Number(process.env.LOOMWERK_DAILY_LLM_REQUESTS ?? 300),
    dailyTokenCap: Number(process.env.LOOMWERK_DAILY_LLM_TOKENS ?? 0),
    prices: {
      cheap: parsePricePair(process.env.LOOMWERK_PRICE_CHEAP),
      judge: parsePricePair(process.env.LOOMWERK_PRICE_JUDGE),
      embed: Number.isFinite(embedPrice) && embedPrice >= 0 ? { in: embedPrice } : null,
    },
  };
}

export function pricingConfigured(cfg: ProviderConfig): boolean {
  return cfg.prices.cheap !== null || cfg.prices.judge !== null || cfg.prices.embed !== null;
}

// --- daily accounting, persisted in the settings table ----------------------
// One JSON blob per UTC day so all caps and sums survive restarts and are
// shared between the app server and the MCP process.

export interface DayStats {
  day: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  costMeasured: number; // USD reported by the gateway
  costPriced: number;   // USD computed from configured rates
}

function today(): string {
  // Local day: as a UTC day the daily token and cost counters would roll over
  // at UTC midnight instead of local midnight.
  return localDay();
}

export function llmDayStats(db: Database): DayStats {
  const empty: DayStats = { day: today(), requests: 0, tokensIn: 0, tokensOut: 0, costMeasured: 0, costPriced: 0 };
  const row = db.prepare("SELECT value FROM settings WHERE key = 'llm.day'").get() as
    | { value: string }
    | undefined;
  if (!row) return empty;
  try {
    const parsed = JSON.parse(row.value) as DayStats;
    return parsed.day === today() ? { ...empty, ...parsed } : empty;
  } catch {
    return empty;
  }
}

export function llmRequestsToday(db: Database): number {
  return llmDayStats(db).requests;
}

function saveDayStats(db: Database, stats: DayStats): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('llm.day', @v)
     ON CONFLICT(key) DO UPDATE SET value = @v, updated_at = ${NOW_SQL}`,
  ).run({ v: JSON.stringify(stats) });
}

function pricedCost(cfg: ProviderConfig, model: string, tokensIn: number, tokensOut: number): number {
  let rate: { in: number; out?: number } | null = null;
  if (model === cfg.models.embed) rate = cfg.prices.embed;
  else if (model === cfg.models.judge && cfg.prices.judge) rate = cfg.prices.judge;
  else if (model === cfg.models.cheap) rate = cfg.prices.cheap;
  else rate = cfg.prices.judge ?? cfg.prices.cheap;
  if (!rate) return 0;
  return (tokensIn / 1e6) * rate.in + (tokensOut / 1e6) * (rate.out ?? 0);
}

// Real cost, when the gateway volunteers it: LiteLLM sends a response
// header, OpenRouter puts a number on the usage object. Anything absent or
// non-numeric counts as "not reported".
function measuredCost(headers: Headers, body: Record<string, unknown>): number {
  const header = Number(headers.get('x-litellm-response-cost'));
  if (Number.isFinite(header) && header > 0) return header;
  const usage = body.usage as { cost?: unknown } | undefined;
  const inline = Number(usage?.cost);
  if (Number.isFinite(inline) && inline > 0) return inline;
  return 0;
}

export function createOpenAiProvider(db: Database, cfg: ProviderConfig): Provider {
  function checkCaps(): void {
    const stats = llmDayStats(db);
    if (stats.requests >= cfg.dailyRequestCap) {
      throw new BudgetExceededError(`daily cap of ${cfg.dailyRequestCap} LLM requests reached`);
    }
    if (cfg.dailyTokenCap > 0 && stats.tokensIn + stats.tokensOut >= cfg.dailyTokenCap) {
      throw new BudgetExceededError(`daily cap of ${cfg.dailyTokenCap} LLM tokens reached`);
    }
  }

  function record(model: string, tokensIn: number, tokensOut: number, measured: number): void {
    const stats = llmDayStats(db);
    stats.requests += 1;
    stats.tokensIn += tokensIn;
    stats.tokensOut += tokensOut;
    if (measured > 0) stats.costMeasured += measured;
    else stats.costPriced += pricedCost(cfg, model, tokensIn, tokensOut);
    saveDayStats(db, stats);
  }

  async function post(
    path: string,
    model: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    checkCaps();
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
      // A failed call still consumed a request slot upstream — count it.
      record(model, 0, 0, 0);
      throw new Error(`provider ${path} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const usage = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    record(model, usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0, measuredCost(res.headers, json));
    return json;
  }

  return {
    models: cfg.models,
    async chat(model, prompt, temperature) {
      const res = (await post('/chat/completions', model, {
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
      const res = (await post('/embeddings', model, {
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
