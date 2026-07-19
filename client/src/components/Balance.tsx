import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type Balance as BalanceData } from '../api';
import { Panel } from './shared';

// The honest self-audit. All numbers come from the server's real
// accounting — no estimates, no placeholder metrics.

const CAT_ORDER = ['culled', 'duplicate', 'gate', 'refuted', 'nugget', 'win', 'open'] as const;
const CAT_COLOR: Record<string, string> = {
  win: 'var(--amber)',
  nugget: 'oklch(0.8 0.15 72 / 0.6)',
  refuted: 'var(--line-2)',
  duplicate: 'var(--faint)',
  gate: 'oklch(0.5 0.006 80 / 0.7)',
  culled: 'var(--line)',
  open: 'var(--dim)',
};

export default function Balance() {
  const { t } = useTranslation();
  const [data, setData] = useState<BalanceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.balance().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p style={{ color: 'var(--amber)' }}>{t('common.error', { message: error })}</p>;
  if (!data) return <p style={{ color: 'var(--dim)' }}>{t('common.loading')}</p>;

  const total = data.total || 1;
  const pct = (n: number) => ((n / total) * 100).toFixed(1) + '%';

  const exportCsv = () => {
    const rows = [['category', 'count', 'pct']];
    for (const k of CAT_ORDER) rows.push([k, String(data.categories[k] ?? 0), ((data.categories[k] ?? 0) / total * 100).toFixed(1)]);
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'loomwerk-balance.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div style={{ maxWidth: 1040, display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 24 }}>
      <Panel style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
          <div className="label" style={{ letterSpacing: '0.08em', fontSize: 11 }}>{t('balance.funnel_title')}</div>
          <div className="mono" style={{ fontSize: 11 }}>{data.total} {t('balance.ideas')}</div>
        </div>
        <div style={{ display: 'flex', height: 12, marginBottom: 22, border: '1px solid var(--line)' }}>
          {CAT_ORDER.map((k) => (
            <div key={k} style={{ width: pct(data.categories[k] ?? 0), background: CAT_COLOR[k] }} />
          ))}
        </div>
        {CAT_ORDER.map((k) => (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: '12px 1fr 60px 60px', gap: 12, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ width: 10, height: 10, background: CAT_COLOR[k] }} />
            <div style={{ fontSize: 13 }}>{t(`balance.cat.${k}`)}</div>
            <div className="mono" style={{ fontSize: 13, textAlign: 'right' }}>{data.categories[k] ?? 0}</div>
            <div className="mono" style={{ fontSize: 11, textAlign: 'right', color: 'var(--dim)' }}>{pct(data.categories[k] ?? 0)}</div>
          </div>
        ))}
      </Panel>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Panel style={{ padding: 18 }}>
          <div className="label" style={{ letterSpacing: '0.08em' }}>{t('balance.success_rate')}</div>
          <div className="mono" style={{ fontSize: 40, fontWeight: 500, color: 'var(--amber)', letterSpacing: '-0.02em', marginTop: 4 }}>
            {(data.successRate * 100).toFixed(1)}%
          </div>
          <div style={{ fontSize: 12, color: 'var(--faint)' }}>
            {data.categories.win ?? 0} {t('balance.wins')} / {data.total}
          </div>
        </Panel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Panel style={{ padding: 18 }}>
            <div className="label">{t('balance.nugget_rate')}</div>
            <div className="mono" style={{ fontSize: 26, fontWeight: 500, marginTop: 4 }}>{(data.nuggetRate * 100).toFixed(1)}%</div>
          </Panel>
          <Panel style={{ padding: 18 }}>
            <div className="label">{t('balance.cycles')}</div>
            <div className="mono" style={{ fontSize: 26, fontWeight: 500, marginTop: 4 }}>{data.cycles}</div>
          </Panel>
        </div>
        <Panel style={{ padding: 18 }}>
          <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0' }}>
            <span style={{ color: 'var(--dim)' }}>{t('balance.llm_requests')}</span>
            <span>{data.llmRequests}</span>
          </div>
          <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderTop: '1px solid var(--line)' }}>
            <span style={{ color: 'var(--dim)' }}>{t('balance.total_spend')}</span>
            <span>${data.costUsd.toFixed(2)}</span>
          </div>
        </Panel>
        <button className="btn btn-ghost" style={{ textAlign: 'center', padding: '11px 0' }} onClick={exportCsv}>
          ↓ {t('balance.export_csv')}
        </button>
      </div>
    </div>
  );
}
