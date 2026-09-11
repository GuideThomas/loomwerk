import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

import { JETZT_SQL, JETZT_SQL_DEFAULT } from './lib/zeit.js';
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
    applied_at TEXT NOT NULL DEFAULT ${JETZT_SQL_DEFAULT}
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

  zeitzoneNachziehen(d);
}

/**
 * Zeitstempel bekommen ihre Zonenkennung (11.09.2026).
 *
 * 🚨 ANLASS: Zeitstempel wurden 2 h zu früh angezeigt. `datetime('now')`
 * schreibt UTC OHNE Kennung ("2026-09-11 19:21:02"); `new Date(...)` liest so
 * einen String als Ortszeit und zieht die zwei Stunden ein zweites Mal ab.
 * Gespeichert bleibt UTC — neu ist allein das `Z`, das den Wert eindeutig macht.
 *
 * ⚠️ WARUM DAS NICHT IN EINER .sql-DATEI STEHT: Zwei Gründe.
 *
 * 1. Die Spalten-Vorgabewerte lassen sich nicht per ALTER ändern — SQLite kennt
 *    kein `ALTER COLUMN SET DEFAULT`, und `CREATE TABLE IF NOT EXISTS` fasst
 *    bestehende Tabellen nicht an. Der Schema-Text muss gepatcht werden, und
 *    dafür braucht es `unsafeMode`, das aus SQL heraus nicht erreichbar ist.
 * 2. Die betroffenen Spalten werden aus dem Schema ERMITTELT, nicht aufgezählt.
 *    Eine gepflegte Liste übersieht die Spalte, die jemand später hinzufügt —
 *    beim ersten Versuch stand hier eine handgeschriebene Liste, und die nannte
 *    eine Tabelle, die es gar nicht gibt.
 *
 * Und eine halbe Umstellung wäre schlimmer als keine: bei gemischten Formaten
 * sortiert SQLite lexikographisch falsch, weil das Leerzeichen (0x20) vor dem
 * 'T' (0x54) liegt. Deshalb Vorgabewert UND Bestand in einem Zug.
 *
 * Idempotent: Läuft nur, solange noch ein Vorgabewert die Altform trägt.
 * Referenz mit vollständiger Prüfung:
 * Projekte/Artikelanlage-Assistent/server/db/migrate.ts §Migration 47
 */
function zeitzoneNachziehen(d: Database.Database): void {
  const alt = d.prepare(`
    SELECT count(*) AS n
      FROM sqlite_master m, pragma_table_info(m.name) p
     WHERE m.type = 'table' AND p.dflt_value LIKE '%datetime(%'
  `).get() as { n: number };
  if (alt.n === 0) return;

  const spalten = d.prepare(`
    SELECT m.name AS tabelle, p.name AS spalte
      FROM sqlite_master m, pragma_table_info(m.name) p
     WHERE m.type = 'table'
       AND m.name NOT LIKE 'sqlite_%'
       AND (p.dflt_value LIKE '%datetime(%'
            OR p.name LIKE '%_at'
            OR p.name = 'ts')
  `).all() as { tabelle: string; spalte: string }[];

  const schemaVersion = d.pragma('schema_version', { simple: true }) as number;

  d.exec('PRAGMA foreign_keys = OFF');
  d.exec('BEGIN');
  try {
    d.unsafeMode(true);
    d.exec('PRAGMA writable_schema = ON');
    // Der Ersatztext wird GEBUNDEN, nicht eingesetzt: JETZT_SQL enthält selbst
    // einfache Anführungszeichen, die das umgebende Literal aufbrechen würden.
    d.prepare(`
      UPDATE sqlite_master
         SET sql = replace(sql, 'datetime(''now'')', ?)
       WHERE type = 'table' AND sql LIKE '%datetime(''now'')%'
    `).run(JETZT_SQL);
    d.exec(`PRAGMA schema_version = ${schemaVersion + 1}`);
    d.exec('PRAGMA writable_schema = OFF');
    d.unsafeMode(false);

    for (const { tabelle, spalte } of spalten) {
      d.prepare(`
        UPDATE "${tabelle}"
           SET "${spalte}" = replace("${spalte}", ' ', 'T') || 'Z'
         WHERE "${spalte}" IS NOT NULL
           AND "${spalte}" LIKE '____-__-__ __:__:__'
      `).run();
    }

    const heil = d.pragma('integrity_check', { simple: true });
    if (heil !== 'ok') throw new Error(`integrity_check: ${heil}`);
    const fk = d.pragma('foreign_key_check') as unknown[];
    if (fk.length > 0) throw new Error(`foreign_key_check: ${fk.length} Verletzung(en)`);

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
