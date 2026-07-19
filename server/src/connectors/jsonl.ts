import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Seed, SeedSource, SourceContext } from '../engine/seeds.js';

// JSONL log connector — the telemetry angle. Agents, cron jobs and services
// leave behind line-delimited logs; a message pattern that repeats N times
// is a tension: something keeps happening that nobody is looking at.
//
// The seed carries FACTS (count + verbatim examples), which arms the
// critic's fact gate: the model can't invent a mechanism the log doesn't
// show. Seeds from here run in 'setup' mode.

export interface JsonlConfig {
  path: string;        // file or directory of *.jsonl / *.log files
  field?: string;      // JSON field holding the message (fallback: raw line)
  threshold?: number;  // min. repetitions to count as a tension
  maxSeeds?: number;
  tailKb?: number;     // only the tail of each file is read
}

// Normalization: digits, hex ids and timestamps collapse so "timeout after
// 31s" and "timeout after 187s" are the same pattern.
export function normalizePattern(msg: string): string {
  return msg
    .toLowerCase()
    .replace(/\b[0-9a-f]{8,}\b/g, '#id')
    .replace(/\d{4}-\d{2}-\d{2}[t ]?[\d:.]*z?/g, '#ts')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function tailLines(file: string, tailKb: number): string[] {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return [];
  }
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, tailKb * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    // first line of a tail read is usually cut off mid-line
    if (size > len) lines.shift();
    return lines.map((l) => l.trim()).filter(Boolean);
  } finally {
    fs.closeSync(fd);
  }
}

export function createJsonlSource(name: string, config: JsonlConfig): SeedSource {
  const field = config.field ?? 'message';
  const threshold = config.threshold ?? 5;
  const maxSeeds = config.maxSeeds ?? 3;
  const tailKb = config.tailKb ?? 256;

  return {
    kind: 'jsonl',
    name,
    detect(_ctx: SourceContext): Promise<Seed[]> {
      let files: string[] = [];
      try {
        const stat = fs.statSync(config.path);
        files = stat.isDirectory()
          ? fs
              .readdirSync(config.path)
              .filter((f) => /\.(jsonl|log)$/i.test(f))
              .map((f) => path.join(config.path, f))
          : [config.path];
      } catch {
        console.error(`[jsonl:${name}] path not found: ${config.path}`);
        return Promise.resolve([]);
      }

      const counts = new Map<string, { n: number; examples: string[] }>();
      for (const file of files) {
        for (const line of tailLines(file, tailKb)) {
          let msg = line;
          try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            const v = obj[field];
            if (typeof v === 'string' && v.trim()) msg = v.trim();
          } catch {
            // not JSON — treat the raw line as the message
          }
          const pattern = normalizePattern(msg);
          if (pattern.length < 8) continue;
          const entry = counts.get(pattern) ?? { n: 0, examples: [] };
          entry.n++;
          if (entry.examples.length < 2) entry.examples.push(msg.slice(0, 160));
          counts.set(pattern, entry);
        }
      }

      const top = [...counts.entries()]
        .filter(([, v]) => v.n >= threshold)
        .sort((a, b) => b[1].n - a[1].n)
        .slice(0, maxSeeds);

      const h = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
      return Promise.resolve(
        top.map(([pattern, v]) => ({
          key: `jsonl:${name}:${h(pattern)}`,
          seedType: 'telemetry',
          domain: 'logs',
          topic: name,
          mode: 'setup' as const,
          tension:
            `A log pattern repeats without anyone reacting to it.\n` +
            `FACTS: pattern occurred ${v.n}× in the recent tail of ${files.length} file(s). ` +
            `Verbatim examples: "${v.examples.join('" · "')}". ` +
            `NOT: nothing beyond these log lines is known about the cause or mechanism.`,
          refs: { pattern, count: v.n, files: files.length },
        })),
      );
    },
  };
}
