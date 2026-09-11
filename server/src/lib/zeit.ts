// ── Zeitstempel: eine Schreibweise, die keine Zone verschweigt ──────────────
//
// 🚨 ANLASS (11.09.2026): `datetime('now')` bzw. `CURRENT_TIMESTAMP` liefert
// "2026-09-11 19:21:02" — das ist UTC, aber der String sagt es nicht. Beim
// Lesen wird daraus ein Fehler in zwei Schritten: `new Date(...)` liest einen
// solchen String als ORTSZEIT und zieht die zwei Stunden nochmals ab;
// `toLocaleString` rechnet sie wieder drauf. Übrig bleibt der UTC-Wert.
//
// Gespeichert wird weiterhin UTC — das ist die richtige Ablageform, sie kennt
// keine doppelten Stunden bei der Zeitumstellung. Neu ist allein das `Z` am
// Ende, das den Wert eindeutig macht. Umgerechnet wird erst bei der Anzeige.
//
// Referenz-Umsetzung mit vollständiger Prüfung:
// Projekte/Artikelanlage-Assistent/server/utils/zeit.ts + scripts/zeitzone.test.mjs

/**
 * SQL-Ausdruck für den Jetzt-Zeitpunkt als eindeutiger ISO-8601-String in UTC.
 *
 *   vorher:  updated_at = datetime('now')     → "2026-09-11 19:21:02"
 *   nachher: updated_at = ${JETZT_SQL}        → "2026-09-11T19:21:02Z"
 *
 * ⚠️ In einem DEFAULT muss der Ausdruck geklammert werden — dafür
 * `JETZT_SQL_DEFAULT`.
 */
export const JETZT_SQL = "strftime('%Y-%m-%dT%H:%M:%SZ','now')";

/** Wie `JETZT_SQL`, aber geklammert für die Verwendung in `DEFAULT (...)`. */
export const JETZT_SQL_DEFAULT = `(${JETZT_SQL})`;

/**
 * Jetzt-Zeitpunkt als eindeutiger ISO-8601-String in UTC — für Zeitstempel, die
 * in JavaScript entstehen statt in SQL. Bewusst ohne Millisekunden, damit in
 * derselben Spalte nicht zwei Schreibweisen stehen.
 */
export function jetztIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Bringt einen beliebigen Zeitstempel auf die eindeutige Schreibweise.
 *
 * Altbestand aus der Zeit vor dem 11.09.2026 steht ohne Zonenkennung in der
 * Datenbank. Solche Werte SIND UTC — sie kamen aus `datetime('now')` — nur
 * sagen sie es nicht. Sie bekommen das `Z`, ohne dass der Zeitpunkt sich
 * verschiebt. Werte mit Kennung bleiben unangetastet.
 */
export function normalisiereZeitstempel(wert: string | null | undefined): string | null {
  if (wert === null || wert === undefined) return null;

  const roh = String(wert).trim();
  if (roh === '') return null;

  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(roh)) return roh;

  const treffer = roh.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if (treffer) {
    const [, datum, stundeMinute, sekunde] = treffer;
    return `${datum}T${stundeMinute}:${sekunde ?? '00'}Z`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(roh)) return `${roh}T00:00:00Z`;

  // Nicht erkannt: unverändert zurückgeben statt zu raten. Ein falsch
  // geratener Zeitstempel ist schlimmer als ein unveränderter.
  return roh;
}

/**
 * Der Tag eines Zeitpunkts als `YYYY-MM-DD` — in Wiener Zeit.
 *
 * 🚨 Ersetzt `new Date().toISOString().slice(0,10)` als Tagesschlüssel. Das
 * liefert den UTC-Tag: Zähler und Kontingente rollen dann um 02:00 Ortszeit
 * statt um Mitternacht.
 */
export function tagInWien(zeitpunkt: Date = new Date()): string {
  const teile = new Intl.DateTimeFormat('de-AT', {
    timeZone: 'Europe/Vienna',
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(zeitpunkt);
  const teil = (art: Intl.DateTimeFormatPartTypes) =>
    teile.find((t) => t.type === art)?.value ?? '';
  return `${teil('year')}-${teil('month')}-${teil('day')}`;
}
