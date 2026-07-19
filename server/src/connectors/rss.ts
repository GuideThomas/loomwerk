import crypto from 'node:crypto';
import type { Seed, SeedSource, SourceContext } from '../engine/seeds.js';

// RSS/Atom connector. Feeds are a stream of *other people's* attention —
// the tension lives between two items that circle different things in the
// same window. Pairing two headlines forces the combination move; a single
// article would just get summarized.
//
// Parsing is a small tolerant hand-rolled pass (title/link/date/summary
// from <item> and <entry>) — a full XML dependency for this would be the
// heavier and more fragile choice.

export interface RssConfig {
  url: string;
  maxItems?: number;
  windowDays?: number;
  maxSeeds?: number;
  domain?: string;
}

export interface FeedItem {
  title: string;
  link: string;
  date: number | null; // epoch ms
  summary: string;
}

function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decode(m[1]!.trim()) : '';
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const block of blocks) {
    const title = pick(block, 'title');
    if (!title) continue;
    // Atom links live in an attribute; RSS links in the element body.
    const atomLink = block.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    const link = atomLink ?? pick(block, 'link') ?? '';
    const dateRaw =
      pick(block, 'pubDate') || pick(block, 'published') || pick(block, 'updated') || pick(block, 'dc:date');
    const parsed = dateRaw ? Date.parse(dateRaw) : NaN;
    items.push({
      title,
      link,
      date: Number.isNaN(parsed) ? null : parsed,
      summary: (pick(block, 'description') || pick(block, 'summary') || pick(block, 'content')).slice(0, 300),
    });
  }
  return items;
}

function sharedWords(a: string, b: string): number {
  const words = (t: string) =>
    new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4));
  const wa = words(a);
  let n = 0;
  for (const w of words(b)) if (wa.has(w)) n++;
  return n;
}

export function pairItems(items: FeedItem[], feedName: string, cfg: RssConfig): Seed[] {
  const maxSeeds = cfg.maxSeeds ?? 3;
  const domain = cfg.domain ?? 'feed';
  const h = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
  const seeds: Seed[] = [];
  const used = new Set<number>();
  for (let i = 0; i < items.length && seeds.length < maxSeeds; i++) {
    if (used.has(i)) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;
      const a = items[i]!;
      const b = items[j]!;
      // Items about the same story are one pole, not a tension.
      if (sharedWords(a.title, b.title) >= 2) continue;
      used.add(i);
      used.add(j);
      seeds.push({
        key: `rss:pair:${[h(a.link || a.title), h(b.link || b.title)].sort().join('x')}`,
        seedType: 'feed_pair',
        domain,
        topic: feedName,
        mode: 'idea',
        tension:
          `Two current items from the feed "${feedName}" point in different directions:\n` +
          `A "${a.title}"${a.summary ? `: ${a.summary.slice(0, 160)}` : ''}\n` +
          `B "${b.title}"${b.summary ? `: ${b.summary.slice(0, 160)}` : ''}`,
        refs: { feed: feedName, linkA: a.link, linkB: b.link },
      });
      break;
    }
  }
  return seeds;
}

export function createRssSource(name: string, config: RssConfig): SeedSource {
  return {
    kind: 'rss',
    name,
    async detect(_ctx: SourceContext): Promise<Seed[]> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      let xml: string;
      try {
        const res = await fetch(config.url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        xml = await res.text();
      } catch (e) {
        console.error(`[rss:${name}] fetch failed: ${(e as Error).message}`);
        return [];
      } finally {
        clearTimeout(timer);
      }
      let items = parseFeed(xml);
      const windowDays = config.windowDays ?? 7;
      const cutoff = Date.now() - windowDays * 86_400_000;
      const dated = items.filter((it) => it.date !== null);
      // Feeds without dates: fall back to document order.
      items = (dated.length ? dated.filter((it) => it.date! >= cutoff) : items).slice(
        0,
        config.maxItems ?? 8,
      );
      return pairItems(items, name, config);
    },
  };
}
