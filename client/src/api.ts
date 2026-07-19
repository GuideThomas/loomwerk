// Thin typed fetch layer over the server API. All calls are same-origin
// (Vite dev proxy in development, the Express static server in production).

export interface Hypothesis {
  id: number;
  status: string;
  statement: string;
  rationale: string | null;
  domain: string | null;
  niche: string | null;
  seed_refs: string | null;
  score_novelty: number | null;
  score_value: number | null;
  score_feasibility: number | null;
  score_surprise: number | null;
  score_taste: number | null;
  disposition: string | null;
  grounding_note: string | null;
  win_note: string | null;
  thread_id: number | null;
  created_at: string;
}

export interface Thread {
  id: number;
  title: string;
  summary: string | null;
  status: 'open' | 'deepening' | 'dormant' | 'closed';
  depth: number;
  created_at: string;
  last_deepened_at: string | null;
}

export interface ThreadDetail extends Thread {
  chain: Hypothesis[];
}

export interface Source {
  id: number;
  kind: string;
  name: string;
  config: string;
  enabled: number;
  last_run_at: string | null;
}

export interface Run {
  id: number;
  stage: string;
  started_at: string;
  finished_at: string | null;
  ok: number | null;
  counts: string;
  llm_requests: number;
  cost_usd: number;
  error: string | null;
}

export interface Balance {
  total: number;
  categories: Record<string, number>;
  successRate: number;
  nuggetRate: number;
  llmRequests: number;
  costUsd: number;
  cycles: number;
}

export interface Health {
  ok: boolean;
  version: string;
  provider: { configured: boolean; baseUrl?: string; models?: Record<string, string>; dailyRequestCap?: number };
  maxThreadDepth: number;
  sourceCount: number;
  openProvocations: number;
  totalHypotheses: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // keep the status text
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<Health>('/health'),
  provocations: () => request<Hypothesis[]>('/hypotheses?status=provocation'),
  react: (id: number, signal: string, note?: string) =>
    request<{ hypothesis: Hypothesis; actionId?: number; threadId?: number }>(`/hypotheses/${id}/react`, {
      method: 'POST',
      body: JSON.stringify({ signal, note }),
    }),
  threads: () => request<Thread[]>('/threads'),
  threadDetail: (id: number) => request<ThreadDetail>(`/threads/${id}`),
  balance: () => request<Balance>('/balance'),
  sources: () => request<Source[]>('/sources'),
  addSource: (kind: string, name: string, config: Record<string, unknown>) =>
    request<Source>('/sources', { method: 'POST', body: JSON.stringify({ kind, name, config }) }),
  toggleSource: (id: number, enabled: boolean) =>
    request<Source>(`/sources/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  deleteSource: (id: number) => request<{ ok: boolean }>(`/sources/${id}`, { method: 'DELETE' }),
  runs: () => request<Run[]>('/runs'),
  startCycle: () => request<{ started: boolean }>('/engine/cycle', { method: 'POST' }),
};
