import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

// Migrations live in <package root>/migrations. This file sits one level
// below the root in both layouts (src/ during dev, dist/ after build), so a
// single relative hop works for both.
const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new Database(path.join(config.dataDir, 'loomwerk.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

// Test hook: run everything against a throwaway database.
export function openTestDb(): Database.Database {
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  migrate(mem);
  return mem;
}

function migrate(d: Database.Database): void {
  d.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(
    d.prepare('SELECT name FROM _migrations').all().map((r) => (r as { name: string }).name),
  );
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const run = d.transaction(() => {
      d.exec(sql);
      d.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    });
    run();
  }
}
