-- Connector support: per-source embedding index and the webhook seed queue.

-- Cache for connector-built indexes (e.g. markdown note embeddings). Keyed
-- by (source, item); mtime detects stale entries so re-indexing only embeds
-- what actually changed — embedding a whole vault should be paid for once.
CREATE TABLE IF NOT EXISTS source_index (
  source_id  INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,                -- e.g. relative note path
  mtime      INTEGER NOT NULL,             -- epoch ms of the indexed version
  meta       TEXT NOT NULL DEFAULT '{}',   -- JSON: title, topic, excerpt hash…
  vec        TEXT,                         -- JSON number[] embedding
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (source_id, key)
);

-- Push-style seeds (webhook/API ingest). External systems — agents, CI,
-- monitoring — POST tensions here; the engine drains the queue each cycle.
CREATE TABLE IF NOT EXISTS pending_seeds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL,
  seed_type   TEXT NOT NULL DEFAULT 'webhook',
  domain      TEXT,
  topic       TEXT,
  mode        TEXT NOT NULL DEFAULT 'idea' CHECK (mode IN ('setup','idea')),
  tension     TEXT NOT NULL,
  refs        TEXT NOT NULL DEFAULT '{}',  -- JSON
  consumed_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pending_seeds_open ON pending_seeds(consumed_at);
