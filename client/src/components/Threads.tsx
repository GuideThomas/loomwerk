import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ThreadDetail } from '../api';
import { MonoBadge, Panel } from './shared';

// Threads as vertical depth chains. Status mapping: open/deepening →
// active, dormant → dormant, closed → ripe (verdict due). Graduating a
// ripe thread promotes its final step into a concrete action.

export default function Threads({ maxDepth, onChanged }: { maxDepth: number; onChanged: () => void }) {
  const { t } = useTranslation();
  const [threads, setThreads] = useState<ThreadDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [graduated, setGraduated] = useState<Record<number, boolean>>({});

  useEffect(() => {
    api
      .threads()
      .then((list) => Promise.all(list.map((th) => api.threadDetail(th.id))))
      .then(setThreads)
      .catch((e: Error) => setError(e.message));
  }, []);

  const graduate = async (th: ThreadDetail) => {
    const last = th.chain[th.chain.length - 1];
    if (!last) return;
    await api.react(last.id, 'promoted');
    setGraduated((s) => ({ ...s, [th.id]: true }));
    onChanged();
  };

  if (error) return <p style={{ color: 'var(--amber)' }}>{t('common.error', { message: error })}</p>;
  if (threads === null) return <p style={{ color: 'var(--dim)' }}>{t('common.loading')}</p>;
  if (threads.length === 0) return <p style={{ color: 'var(--dim)', maxWidth: 480 }}>{t('threads.empty')}</p>;

  const stateOf = (s: ThreadDetail['status']) =>
    s === 'closed' ? 'ripe' : s === 'dormant' ? 'dormant' : 'active';

  return (
    <div style={{ maxWidth: 880, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {threads.map((th) => {
        const state = stateOf(th.status);
        const stateLabelKey = state === 'ripe' ? 'threads.state_ripe' : state === 'dormant' ? 'threads.state_dormant' : 'threads.state_active';
        return (
          <Panel key={th.id}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>THR-{th.id}</span>
                  <MonoBadge
                    label={t(stateLabelKey)}
                    tone={state === 'ripe' ? 'amber' : state === 'dormant' ? 'faint' : 'dim'}
                  />
                </div>
                <div style={{ fontSize: 17, fontWeight: 600, marginTop: 7, letterSpacing: '-0.01em' }}>{th.title}</div>
                {th.summary && <div style={{ color: 'var(--dim)', fontSize: 12.5, marginTop: 4 }}>{th.summary}</div>}
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', whiteSpace: 'nowrap' }}>
                {t('threads.depth')} {th.chain.length}/{maxDepth}
              </div>
            </div>

            <div style={{ padding: '6px 18px 16px' }}>
              {th.chain.map((h, i) => {
                const isLast = i === th.chain.length - 1;
                return (
                  <div key={h.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 14 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div
                        className="mono"
                        style={{
                          width: 24, height: 24, marginTop: 14,
                          border: `1px solid ${isLast ? 'var(--amber)' : 'var(--line-2)'}`,
                          background: isLast ? 'var(--amber)' : 'transparent',
                          color: isLast ? 'var(--on-amber)' : 'var(--dim)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 600,
                        }}
                      >
                        {i + 1}
                      </div>
                      {!isLast && <div style={{ flex: 1, width: 1, background: 'var(--line-2)', minHeight: 14 }} />}
                    </div>
                    <div style={{ padding: '14px 0 4px' }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{h.statement}</div>
                      {h.rationale && (
                        <div style={{ color: 'var(--dim)', fontSize: 12.5, marginTop: 3, lineHeight: 1.5 }}>{h.rationale}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {state === 'ripe' && (
              <div style={{ borderTop: '1px solid var(--amber)', background: 'var(--amber-soft)', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                <div style={{ fontSize: 13 }}>{t('threads.graduate_hint')}</div>
                <button
                  className="btn"
                  style={{
                    padding: '9px 18px', fontWeight: 600, whiteSpace: 'nowrap',
                    border: '1px solid var(--amber)',
                    background: graduated[th.id] ? 'var(--amber-soft)' : 'var(--amber)',
                    color: graduated[th.id] ? 'var(--amber)' : 'var(--on-amber)',
                  }}
                  disabled={!!graduated[th.id]}
                  onClick={() => void graduate(th)}
                >
                  {graduated[th.id] ? t('threads.graduated') : t('threads.graduate')}
                </button>
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}
