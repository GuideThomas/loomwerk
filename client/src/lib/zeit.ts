// ── Zeitstempel anzeigen: immer Wien, nie die Zone des Betrachters ──────────
//
// 🚨 ANLASS (11.09.2026): Zeitstempel wurden durchgängig 2 h zu früh angezeigt.
//
//   DB-Wert (UTC)  : 2026-09-11 19:21:02      ← aus datetime('now'), ohne Zone
//   Node parst als : 2026-09-11T17:21:02.000Z ← liest ihn als Ortszeit, −2 h
//   Anzeige de-AT  : 11.9.2026, 19:21:02      ← rechnet +2 h, landet bei UTC
//   KORREKT wäre   : 11.9.2026, 21:21:02
//
// Nicht das System war falsch eingestellt — der VPS steht auf Europe/Berlin,
// versatzgleich mit Wien, NTP-synchron. Falsch war die Kette aus zwei Stellen,
// die sich gegenseitig verschleiern: Der gespeicherte String trug keine Zone,
// und die Anzeige nagelte keine fest.
//
// ⚠️ `Europe/Vienna` STATT "+2": Der Versatz ist im Sommer 2 h, ab dem
// 25.10.2026 nur noch 1 h. Die Zonenkennung führt den Wechsel selbst mit.
//
// ⚠️ DIE ZONE WIRD FEST GESETZT, NICHT VOM BROWSER ÜBERNOMMEN. Sonst sieht ein
// Zugriff über VPN oder aus dem Urlaub andere Uhrzeiten für dieselbe Zeile.
//
// Referenz-Umsetzung mit vollständiger Prüfung:
// Projekte/Artikelanlage-Assistent/src/utils/zeit.ts + scripts/zeitzone.test.mjs

/** Die Zone, in der diese Anwendung Zeitpunkte anzeigt — ausnahmslos. */
export const ZONE = 'Europe/Vienna';

/** Die Sprachumgebung für Datums- und Zeitformate. */
export const LOCALE = 'de-AT';

/**
 * Liest einen Zeitstempel aus der Datenbank in ein `Date`.
 *
 * 🚨 Der Kern der Reparatur: Ein Wert ohne Zonenkennung wird als UTC gelesen,
 * NICHT als Ortszeit. Genau andersherum macht es `new Date(...)`, und das war
 * der Fehler.
 *
 * @returns ein `Date`, oder `null` wenn der Wert leer oder unlesbar war
 */
export function alsDatum(wert: string | number | Date | null | undefined): Date | null {
  if (wert === null || wert === undefined || wert === '') return null;

  if (wert instanceof Date) return Number.isNaN(wert.getTime()) ? null : wert;
  if (typeof wert === 'number') {
    const ausZahl = new Date(wert);
    return Number.isNaN(ausZahl.getTime()) ? null : ausZahl;
  }

  const roh = String(wert).trim();
  if (roh === '') return null;

  // Trägt schon eine Zonenkennung (Z oder +02:00 / -05:00)? Dann direkt parsen.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(roh)) {
    const mitZone = new Date(roh.replace(' ', 'T'));
    return Number.isNaN(mitZone.getTime()) ? null : mitZone;
  }

  // Zonenlos → als UTC lesen. Das ist die Altform aus datetime('now').
  const treffer = roh.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if (treffer) {
    const [, datum, stundeMinute, sekunde] = treffer;
    const alsUtc = new Date(`${datum}T${stundeMinute}:${sekunde ?? '00'}Z`);
    return Number.isNaN(alsUtc.getTime()) ? null : alsUtc;
  }

  // Reines Datum ohne Uhrzeit — als Mitternacht UTC lesen
  if (/^\d{4}-\d{2}-\d{2}$/.test(roh)) {
    const nurDatum = new Date(`${roh}T00:00:00Z`);
    return Number.isNaN(nurDatum.getTime()) ? null : nurDatum;
  }

  const rest = new Date(roh);
  return Number.isNaN(rest.getTime()) ? null : rest;
}

/** Formatierer auf Wien — gecacht, weil `Intl` teuer zu erzeugen ist. */
const formatierer = new Map<string, Intl.DateTimeFormat>();
function hol(optionen: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const schluessel = JSON.stringify(optionen);
  let fertig = formatierer.get(schluessel);
  if (!fertig) {
    fertig = new Intl.DateTimeFormat(LOCALE, { ...optionen, timeZone: ZONE });
    formatierer.set(schluessel, fertig);
  }
  return fertig;
}

/** Datum und Uhrzeit in Wiener Zeit — die Vorgabe für Zeitstempel in der Oberfläche. */
export function formatDatumZeit(
  wert: string | number | Date | null | undefined,
  ersatz = '—',
): string {
  const datum = alsDatum(wert);
  if (!datum) return ersatz;
  return hol({
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(datum);
}

/** Nur das Datum, in Wiener Zeit. */
export function formatDatum(
  wert: string | number | Date | null | undefined,
  ersatz = '—',
): string {
  const datum = alsDatum(wert);
  if (!datum) return ersatz;
  return hol({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(datum);
}

/** Nur die Uhrzeit, in Wiener Zeit. */
export function formatZeit(
  wert: string | number | Date | null | undefined,
  ersatz = '—',
): string {
  const datum = alsDatum(wert);
  if (!datum) return ersatz;
  return hol({ hour: '2-digit', minute: '2-digit' }).format(datum);
}

/** Datum und Uhrzeit mit Sekunden — für Protokolle und Verlaufsansichten. */
export function formatDatumZeitGenau(
  wert: string | number | Date | null | undefined,
  ersatz = '—',
): string {
  const datum = alsDatum(wert);
  if (!datum) return ersatz;
  return hol({
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(datum);
}

/**
 * Der Tag eines Zeitpunkts als `YYYY-MM-DD` — in Wiener Zeit.
 *
 * 🚨 Ersetzt `.slice(0, 10)` auf einem UTC-Wert und `toISOString().slice(0,10)`.
 * Beide schneiden den **UTC**-Tag ab: Zwischen 00:00 und 02:00 Wiener Zeit ist
 * das der Vortag. Genau dieser Fehler steckt in mehreren Projekten in
 * Tagesfiltern, Tageszählern und Dateinamen.
 */
export function tagInWien(wert: string | number | Date | null | undefined, ersatz = ''): string {
  const datum = alsDatum(wert);
  if (!datum) return ersatz;
  const teile = hol({ day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(datum);
  const teil = (art: Intl.DateTimeFormatPartTypes) =>
    teile.find((t) => t.type === art)?.value ?? '';
  return `${teil('year')}-${teil('month')}-${teil('day')}`;
}

/** Eigene Formatwünsche, aber garantiert in Wiener Zeit. */
export function formatMit(
  wert: string | number | Date | null | undefined,
  optionen: Intl.DateTimeFormatOptions,
  ersatz = '—',
): string {
  const datum = alsDatum(wert);
  if (!datum) return ersatz;
  return hol(optionen).format(datum);
}
