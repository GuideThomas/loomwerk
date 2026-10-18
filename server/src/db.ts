import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

import { NOW_SQL, NOW_SQL_DEFAULT } from './lib/time.js';
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
    applied_at TEXT NOT NULL DEFAULT ${NOW_SQL_DEFAULT}
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

  migrateTimestampsToUtcZ(d);
}

/**
 * Gives stored timestamps their zone marker (v0.3.1).
 *
 * `datetime('now')` writes UTC WITHOUT a marker ("2026-09-11 19:21:02"), and
 * `new Date(...)` reads such a string as local time — the display ended up off
 * by the local offset. Storage stays UTC; the only change is the `Z` that makes
 * the value unambiguous.
 *
 * ⚠️ WHY THIS IS NOT A .sql MIGRATION — two reasons:
 *
 * 1. Column defaults can't be changed with ALTER — SQLite has no
 *    `ALTER COLUMN SET DEFAULT`, and `CREATE TABLE IF NOT EXISTS` leaves
 *    existing tables alone. The schema text itself has to be patched, which
 *    needs `unsafeMode` — not reachable from plain SQL.
 * 2. The affected columns are DISCOVERED from the schema, not listed by hand.
 *    A maintained list misses the column someone adds later.
 *
 * A half-done conversion would be worse than none: with mixed notations SQLite
 * sorts lexicographically wrong, because the space (0x20) sorts before the
 * 'T' (0x54). So defaults AND existing rows are converted in one go.
 *
 * Idempotent: only runs while some column default still uses the old form.
 */
function migrateTimestampsToUtcZ(d: Database.Database): void {
  const legacy = d.prepare(`
    SELECT count(*) AS n
      FROM sqlite_master m, pragma_table_info(m.name) p
     WHERE m.type = 'table' AND p.dflt_value LIKE '%datetime(%'
  `).get() as { n: number };
  if (legacy.n === 0) return;

  const columns = d.prepare(`
    SELECT m.name AS tbl, p.name AS col
      FROM sqlite_master m, pragma_table_info(m.name) p
     WHERE m.type = 'table'
       AND m.name NOT LIKE 'sqlite_%'
       AND (p.dflt_value LIKE '%datetime(%'
            OR p.name LIKE '%_at'
            OR p.name = 'ts')
  `).all() as { tbl: string; col: string }[];

  const schemaVersion = d.pragma('schema_version', { simple: true }) as number;

  d.exec('PRAGMA foreign_keys = OFF');
  d.exec('BEGIN');
  try {
    d.unsafeMode(true);
    d.exec('PRAGMA writable_schema = ON');
    // The replacement is BOUND, not interpolated: NOW_SQL itself contains
    // single quotes that would break the surrounding literal.
    d.prepare(`
      UPDATE sqlite_master
         SET sql = replace(sql, 'datetime(''now'')', ?)
       WHERE type = 'table' AND sql LIKE '%datetime(''now'')%'
    `).run(NOW_SQL);
    d.exec(`PRAGMA schema_version = ${schemaVersion + 1}`);
    d.exec('PRAGMA writable_schema = OFF');
    d.unsafeMode(false);

    for (const { tbl, col } of columns) {
      d.prepare(`
        UPDATE "${tbl}"
           SET "${col}" = replace("${col}", ' ', 'T') || 'Z'
         WHERE "${col}" IS NOT NULL
           AND "${col}" LIKE '____-__-__ __:__:__'
      `).run();
    }

    const integrity = d.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`integrity_check: ${integrity}`);
    const fk = d.pragma('foreign_key_check') as unknown[];
    if (fk.length > 0) throw new Error(`foreign_key_check: ${fk.length} violation(s)`);

    d.exec('COMMIT');
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  } finally {
    d.exec('PRAGMA writable_schema = OFF');
    d.unsafeMode(false);
    d.exec('PRAGMA foreign_keys = ON');
  }
}
