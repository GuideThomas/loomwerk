import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Hypothesis } from '../api';

export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="panel" style={style}>
      {children}
    </div>
  );
}

export function MonoBadge({
  label,
  tone,
}: {
  label: string;
  tone: 'amber' | 'dim' | 'faint';
}) {
  const color = tone === 'amber' ? 'var(--amber)' : tone === 'dim' ? 'var(--fg)' : 'var(--faint)';
  const line = tone === 'amber' ? 'var(--amber)' : tone === 'dim' ? 'var(--line-2)' : 'var(--line)';
  const bg = tone === 'amber' ? 'var(--amber-soft)' : 'transparent';
  return (
    <span
      className="mono"
      style={{
        border: `1px solid ${line}`,
        color,
        background: bg,
        fontSize: 10,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        padding: '4px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

// The four sub-scores as compact instrument bars. Values arrive as 0..1
// floats from the judge; display is 0..100.
export function ScoreBars({ h, compact }: { h: Hypothesis; compact?: boolean }) {
  const { t } = useTranslation();
  const bars = [
    [t('inbox.score_nov'), h.score_novelty],
    [t('inbox.score_val'), h.score_value],
    [t('inbox.score_fea'), h.score_feasibility],
    [t('inbox.score_sur'), h.score_surprise],
  ] as const;
  return (
    <div
      style={
        compact
          ? { display: 'flex', flexDirection: 'column', gap: 4 }
          : { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 28px', marginTop: 2 }
      }
    >
      {bars.map(([k, raw]) => {
        const v = raw === null ? null : Math.round(raw * 100);
        const color = v !== null && v >= 70 ? 'var(--amber)' : 'var(--line-2)';
        return (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: compact ? 7 : 10 }}>
            <span className="mono" style={{ fontSize: compact ? 9 : 10, color: 'var(--dim)', width: compact ? 26 : 30 }}>
              {k}
            </span>
            <div style={{ flex: 1, height: compact ? 4 : 6, background: 'var(--panel-2)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${v ?? 0}%`, background: color }} />
            </div>
            <span className="mono" style={{ fontSize: compact ? 9.5 : 11, width: compact ? 18 : 22, textAlign: 'right', color: v !== null && v >= 70 ? 'var(--amber)' : 'var(--dim)' }}>
              {v ?? '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function tasteLabel(taste: number | null): { text: string; color: string } {
  if (taste === null) return { text: '·', color: 'var(--faint)' };
  return {
    text: (taste >= 0 ? '+' : '') + taste.toFixed(2),
    color: taste >= 0 ? 'var(--amber)' : 'var(--faint)',
  };
}

// A note like "4 claims confirmed, 0 refuted" contains the word "refuted"
// without meaning it — only a non-zero refutation counts as a red badge.
export function groundingVerdict(note: string | null): 'confirmed' | 'refuted' | null {
  if (!note) return null;
  const stripped = note.replace(/\b0\s+(refuted|widerlegt)\b/gi, '');
  return /refut|widerlegt/i.test(stripped) ? 'refuted' : 'confirmed';
}
