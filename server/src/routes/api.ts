import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Database } from 'better-sqlite3';
import {
  ApiError,
  createHypothesis,
  getHypothesis,
  listHypotheses,
  reactToHypothesis,
  setWinNote,
  type Actor,
  type HypothesisStatus,
  type Signal,
} from '../lib/hypotheses.js';
import { getThreadDetail, listThreads } from '../lib/threads.js';
import { listRuns } from '../lib/runs.js';
import { runCycle } from '../engine/cycle.js';
import { createOpenAiProvider, providerConfigFromEnv } from '../engine/provider.js';
import { config } from '../config.js';

const SIGNALS: Signal[] = ['promoted', 'pursued', 'ignored', 'dismissed', 'loved'];
const STATUSES: HypothesisStatus[] = [
  'seed',
  'candidate',
  'provocation',
  'thread',
  'promoted',
  'dismissed',
];

export function apiRouter(db: Database): Router {
  const r = Router();

  // Optional bearer auth — only enforced when a token is configured.
  r.use((req: Request, res: Response, next: NextFunction) => {
    if (!config.apiToken) return next();
    const header = req.headers.authorization ?? '';
    if (header === `Bearer ${config.apiToken}`) return next();
    res.status(401).json({ error: 'unauthorized' });
  });

  r.get('/health', (_req, res) => {
    res.json({ ok: true, version: '0.1.0-dev' });
  });

  r.get('/hypotheses', (req, res) => {
    const status = req.query.status as HypothesisStatus | undefined;
    if (status && !STATUSES.includes(status)) {
      throw new ApiError(400, `invalid status '${status}'`);
    }
    res.json(
      listHypotheses(db, {
        status,
        domain: req.query.domain as string | undefined,
        wins: req.query.wins === 'true',
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }),
    );
  });

  r.post('/hypotheses', (req, res) => {
    const b = req.body ?? {};
    res.status(201).json(
      createHypothesis(db, {
        statement: b.statement,
        rationale: b.rationale,
        seedType: b.seedType,
        seedRefs: b.seedRefs,
        variationOp: b.variationOp,
        domain: b.domain,
        sourceId: b.sourceId,
        createdBy: b.createdBy === 'human' ? 'human' : 'engine',
        status: b.status === 'provocation' ? 'provocation' : 'candidate',
      }),
    );
  });

  r.get('/hypotheses/:id', (req, res) => {
    res.json(getHypothesis(db, Number(req.params.id)));
  });

  r.post('/hypotheses/:id/react', (req, res) => {
    const { signal, note } = req.body ?? {};
    if (!SIGNALS.includes(signal)) {
      throw new ApiError(400, `signal must be one of ${SIGNALS.join(', ')}`);
    }
    const actor: Actor = req.body?.actor === 'engine' ? 'engine' : 'human';
    res.json(reactToHypothesis(db, Number(req.params.id), signal, actor, note));
  });

  r.patch('/hypotheses/:id/win-note', (req, res) => {
    const winNote = typeof req.body?.winNote === 'string' ? req.body.winNote : null;
    res.json(setWinNote(db, Number(req.params.id), winNote));
  });

  r.get('/threads', (_req, res) => {
    res.json(listThreads(db));
  });

  r.get('/threads/:id', (req, res) => {
    res.json(getThreadDetail(db, Number(req.params.id)));
  });

  r.get('/actions', (_req, res) => {
    res.json(db.prepare('SELECT * FROM actions ORDER BY id DESC LIMIT 200').all());
  });

  r.get('/runs', (_req, res) => {
    res.json(listRuns(db));
  });

  // Manual cycle trigger. Long-running, so it answers 202 immediately —
  // progress lands in the runs table (GET /api/runs).
  let cycleInFlight = false;
  r.post('/engine/cycle', (_req, res) => {
    const cfg = providerConfigFromEnv();
    if (!cfg) {
      throw new ApiError(409, 'no LLM provider configured (set LOOMWERK_LLM_BASE_URL and LOOMWERK_LLM_API_KEY)');
    }
    if (cycleInFlight) throw new ApiError(409, 'a cycle is already running');
    cycleInFlight = true;
    void runCycle(db, createOpenAiProvider(db, cfg))
      .catch((e: Error) => console.error('[engine] cycle failed:', e.message))
      .finally(() => {
        cycleInFlight = false;
      });
    res.status(202).json({ started: true });
  });

  // Express 5 forwards thrown errors from sync handlers automatically.
  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  return r;
}
