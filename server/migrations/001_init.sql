-- Loomwerk core schema.
--
-- The central primitive is not a task but a *hypothesis* with its own
-- lifecycle:  TENSION (seed) -> HYPOTHESIS (variation) -> PROVOCATION
-- (curated) -> THREAD (matured) -> ACTION | dismissed.
--
-- Design notes:
--  * SQLite on purpose: local-first, zero setup, and the volumes involved
--    (tens to hundreds of rows per day) never justify anything heavier.
--  * Scores stay NULL until the critic stage has run.
--  * Human decisions are never overwritten by the machine; the machine only
--    appends to the disposition audit trail.

-- Long-running research lines. A thread accumulates depth over weeks —
-- this is what separates an innovator from a task runner.
CREATE TABLE IF NOT EXISTS threads (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT NOT NULL,
  summary          TEXT,
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','deepening','dormant','closed')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_deepened_at TEXT
);

CREATE TABLE IF NOT EXISTS hypotheses (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  status           TEXT NOT NULL DEFAULT 'seed'
                     CHECK (status IN ('seed','candidate','provocation','thread','promoted','dismissed')),
  -- provenance (variation stage)
  seed_type        TEXT,   -- e.g. cross_domain | contradiction | telemetry | feed | log | manual
  seed_refs        TEXT,   -- JSON: source ids / note paths / query behind the tension
  variation_op     TEXT,   -- analogy | combination | inversion | constraint | scaling
  domain           TEXT,   -- free-form bucket, set by the source connector
  source_id        INTEGER,-- FK to sources, nullable for manual/demo entries
  -- content
  statement        TEXT NOT NULL,
  rationale        TEXT,
  -- selection (critic stage) — NULL until scored
  score_novelty     REAL,
  score_value       REAL,
  score_feasibility REAL,
  score_surprise    REAL,
  score_taste       REAL,  -- learned fit: cos(emb, liked) - cos(emb, disliked)
  niche            TEXT,   -- MAP-elites bucket (domain x variation_op)
  -- maturation
  thread_id        INTEGER REFERENCES threads(id) ON DELETE SET NULL,
  parent_id        INTEGER REFERENCES hypotheses(id) ON DELETE SET NULL,
  -- human verdicts / bookkeeping
  disposition      TEXT
                     CHECK (disposition IS NULL OR disposition IN ('promoted','pursued','ignored','dismissed','loved')),
  disposition_at   TEXT,
  promoted_action_id INTEGER REFERENCES actions(id) ON DELETE SET NULL,
  grounding_note   TEXT,   -- verdict badge of the automatic fact check (pre-grounding)
  win_note         TEXT,   -- curated note on what this idea actually delivered
  created_by       TEXT NOT NULL DEFAULT 'engine'
                     CHECK (created_by IN ('human','engine')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hypotheses_status  ON hypotheses(status);
CREATE INDEX IF NOT EXISTS idx_hypotheses_thread  ON hypotheses(thread_id);
CREATE INDEX IF NOT EXISTS idx_hypotheses_domain  ON hypotheses(domain);
CREATE INDEX IF NOT EXISTS idx_hypotheses_niche   ON hypotheses(niche);

-- Append-only audit trail of decisions. This is the raw signal the taste
-- model learns from, so it is never mutated or deleted.
CREATE TABLE IF NOT EXISTS dispositions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  hypothesis_id    INTEGER NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
  signal           TEXT NOT NULL
                     CHECK (signal IN ('promoted','pursued','ignored','dismissed','loved')),
  actor            TEXT NOT NULL DEFAULT 'human',   -- 'human' | 'engine'
  note             TEXT,
  ts               TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dispositions_hyp ON dispositions(hypothesis_id);

-- What a promoted idea turns into. Loomwerk does not run your tasks — it
-- hands them over: as a markdown file, a webhook call, or just this record.
CREATE TABLE IF NOT EXISTS actions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  hypothesis_id    INTEGER NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  body             TEXT,
  export_target    TEXT NOT NULL DEFAULT 'none'
                     CHECK (export_target IN ('none','file','webhook')),
  export_ref       TEXT,   -- file path or webhook response id
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','done','cancelled')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Statement embeddings, cached. SQLite has no vector type; a JSON array is
-- fine at these volumes and keeps the whole system dependency-free.
CREATE TABLE IF NOT EXISTS embeddings (
  hypothesis_id INTEGER PRIMARY KEY REFERENCES hypotheses(id) ON DELETE CASCADE,
  model         TEXT NOT NULL,
  dim           INTEGER NOT NULL,
  vec           TEXT NOT NULL,             -- JSON number[]
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Learned taste centroids (mean embedding per polarity of past decisions).
CREATE TABLE IF NOT EXISTS centroids (
  kind        TEXT PRIMARY KEY CHECK (kind IN ('positive','negative')),
  model       TEXT NOT NULL,
  n           INTEGER NOT NULL,
  dim         INTEGER NOT NULL,
  vec         TEXT NOT NULL,               -- JSON number[]
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Registered knowledge sources (connectors). Config is connector-specific
-- JSON; the connector SDK validates it.
CREATE TABLE IF NOT EXISTS sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,               -- markdown | rss | jsonl | webhook | demo
  name        TEXT NOT NULL,
  config      TEXT NOT NULL DEFAULT '{}',  -- JSON
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per pipeline stage execution — feeds the run view and the balance
-- sheet. Honest accounting is a feature: cost per cycle, not estimates.
CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stage       TEXT NOT NULL,               -- pulse | critic | fitness | weave | review
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  ok          INTEGER,
  counts      TEXT NOT NULL DEFAULT '{}',  -- JSON: stage-specific counters
  cost_usd    REAL NOT NULL DEFAULT 0,
  llm_requests INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_stage ON runs(stage, started_at);

-- Key-value settings (provider config, language, budget cap, ...).
-- Secrets are NOT stored here — the LLM API key comes from the environment.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
