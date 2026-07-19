import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type Health, type Run } from '../api';
import { Panel } from './shared';

// The pipeline as a build log. One cycle = the four newest stage rows;
// history below. Triggering a cycle polls until the stages land.

const STAGE_ORDER = ['pulse', 'critic', 'fitness', 'weave'];

export default function RunView({ health, onChanged }: { health: Health | null; onChanged: () => void }) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    api.runs().then(setRuns).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [load]);

  const trigger = async () => {
    setError(null);
    try {
      await api.startCycle();
      setInFlight(true);
      const before = runs?.length ?? 0;
      pollTimer.current = setInterval(() => {
        void api.runs().then((r) => {
          setRuns(r);
          // a full cycle appends 4 stage rows; stop polling once the last
          // one has a finished_at
          if (r.length >= before + 4 && r[0]?.finished_at) {
            if (pollTimer.current) clearInterval(pollTimer.current);
            setInFlight(false);
            onChanged();
          }
        });
      }, 2000);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error && runs === null) return <p style={{ color: 'var(--amber)' }}>{t('common.error', { message: error })}</p>;
  if (runs === null) return <p style={{ color: 'var(--dim)' }}>{t('common.loading')}</p>;

  // newest cycle: take the most recent contiguous pulse→weave block
  const latest: Run[] = [];
  for (const stage of STAGE_ORDER) {
    const row = runs.find((r) => r.stage === stage);
    if (row) latest.push(row);
  }
  const rest = runs.filter((r) => !latest.some((l) => l.id === r.id)).slice(0, 20);
  const providerReady = health?.provider.configured ?? false;

  const fmtCounts = (raw: string): string => {
    try {
      const obj = JSON.parse(raw) as Record<string, number>;
      return Object.entries(obj)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k} ${v}`)
        .join(' · ');
    } catch {
      return '';
    }
  };

  return (
    <div style={{ maxWidth: 900 }}>
      <Panel style={{ padding: '16px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--dim)' }}>
          {error ? (
            <span style={{ color: 'var(--amber)' }}>{error}</span>
          ) : providerReady ? (
            `${t('run.last_cycle')}: ${latest[0]?.started_at ?? '—'}`
          ) : (
            t('run.no_provider')
          )}
        </div>
        <button
          className={`btn ${inFlight ? 'btn-ghost pulsing' : 'btn-primary'}`}
          disabled={inFlight || !providerReady}
          onClick={() => void trigger()}
        >
          {inFlight ? t('run.in_flight') : `▶ ${t('run.trigger')}`}
        </button>
      </Panel>

      {latest.length === 0 && <p style={{ color: 'var(--dim)' }}>{t('run.empty')}</p>}

      {latest.length > 0 && (
        <Panel>
          {latest.map((r, i) => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '34px 1fr', gap: 16, padding: 18, borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: r.ok ? 'var(--amber)' : 'var(--line-2)', marginTop: 4 }} />
                {i < latest.length - 1 && <div style={{ flex: 1, width: 1, background: 'var(--line-2)', marginTop: 4, minHeight: 30 }} />}
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>0{i + 1}</span>
                    <span style={{ fontSize: 16, fontWeight: 600, textTransform: 'capitalize' }}>{r.stage}</span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '2px 6px',
                        color: r.ok ? 'var(--amber)' : 'var(--faint)',
                        border: `1px solid ${r.ok ? 'var(--amber)' : 'var(--line-2)'}`,
                      }}
                    >
                      {r.ok ? t('run.done') : t('run.failed')}
                    </span>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--dim)' }}>
                    {r.llm_requests} {t('run.requests')}
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 4 }}>{t(`run.stage_desc.${r.stage}`, { defaultValue: '' })}</div>
                <div className="mono" style={{ fontSize: 11, marginTop: 10, color: 'var(--fg)' }}>
                  {r.error ? <span style={{ color: 'var(--amber)' }}>{r.error}</span> : fmtCounts(r.counts)}
                </div>
              </div>
            </div>
          ))}
        </Panel>
      )}

      {rest.length > 0 && (
        <>
          <div className="label" style={{ margin: '24px 0 10px', letterSpacing: '0.08em', fontSize: 11 }}>{t('run.history')}</div>
          <Panel>
            {rest.map((r) => (
              <div key={r.id} className="mono" style={{ display: 'flex', gap: 14, padding: '8px 14px', borderBottom: '1px solid var(--line)', fontSize: 11, color: 'var(--dim)' }}>
                <span style={{ color: 'var(--faint)', width: 130, flex: '0 0 auto' }}>{r.started_at}</span>
                <span style={{ width: 60, flex: '0 0 auto', textTransform: 'capitalize' }}>{r.stage}</span>
                <span style={{ color: r.ok ? 'var(--dim)' : 'var(--amber)' }}>{r.error ?? fmtCounts(r.counts)}</span>
              </div>
            ))}
          </Panel>
        </>
      )}
    </div>
  );
}
