import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type Health, type Source } from '../api';
import { Panel } from './shared';

import { formatDatumZeit } from '../lib/zeit';
// Source management: connect what you already read and write. The right
// panel shows the engine's real knobs (environment-driven) — read-only on
// purpose, so the UI never pretends to control what it doesn't.

const KIND_TYPE: Record<string, string> = { markdown: 'FS', rss: 'RSS', jsonl: 'JSONL', demo: 'DEMO' };

export default function Sources({ health, onChanged }: { health: Health | null; onChanged: () => void }) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<'markdown' | 'rss' | 'jsonl'>('markdown');
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');

  const load = () => {
    api.sources().then(setSources).catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);

  const add = async () => {
    if (!name.trim() || !target.trim()) return;
    const config = kind === 'rss' ? { url: target.trim() } : { path: target.trim() };
    await api.addSource(kind, name.trim(), config);
    setName('');
    setTarget('');
    load();
    onChanged();
  };

  const summarize = (s: Source): string => {
    try {
      const cfg = JSON.parse(s.config) as { path?: string; url?: string };
      return cfg.path ?? cfg.url ?? '';
    } catch {
      return '';
    }
  };

  if (error) return <p style={{ color: 'var(--amber)' }}>{t('common.error', { message: error })}</p>;

  return (
    <div style={{ maxWidth: 960, display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 24, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {sources !== null && sources.length === 0 && (
          <p style={{ color: 'var(--dim)', fontSize: 13, margin: 0 }}>{t('sources.empty')}</p>
        )}
        {sources?.map((s) => (
          <Panel key={s.id} style={{ padding: '16px 18px', opacity: s.enabled ? 1 : 0.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: 13, alignItems: 'center', minWidth: 0 }}>
                <div className="mono" style={{ width: 34, height: 34, border: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--dim)', flex: '0 0 auto' }}>
                  {KIND_TYPE[s.kind] ?? s.kind.toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
                    {summarize(s)} · {t('sources.last_run')}: {s.last_run_at ? formatDatumZeit(s.last_run_at) : t('sources.never')}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn"
                  style={{ fontSize: 9.5, padding: '5px 9px', border: `1px solid ${s.enabled ? 'var(--amber)' : 'var(--line-2)'}`, color: s.enabled ? 'var(--amber)' : 'var(--faint)' }}
                  onClick={() => void api.toggleSource(s.id, !s.enabled).then(load)}
                >
                  {s.enabled ? t('sources.on') : t('sources.off')}
                </button>
                <button
                  className="btn"
                  style={{ fontSize: 9.5, padding: '5px 9px', border: '1px solid var(--line-2)', color: 'var(--faint)' }}
                  onClick={() => void api.deleteSource(s.id).then(load)}
                >
                  ✕
                </button>
              </div>
            </div>
          </Panel>
        ))}

        <Panel style={{ padding: 18 }}>
          <div className="label" style={{ letterSpacing: '0.08em', fontSize: 11, marginBottom: 14 }}>{t('sources.add_title')}</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {(['markdown', 'rss', 'jsonl'] as const).map((k) => (
              <button
                key={k}
                className="btn"
                style={{ fontSize: 10, padding: '6px 12px', border: `1px solid ${kind === k ? 'var(--amber)' : 'var(--line-2)'}`, color: kind === k ? 'var(--amber)' : 'var(--dim)', background: kind === k ? 'var(--amber-soft)' : 'transparent' }}
                onClick={() => setKind(k)}
              >
                {KIND_TYPE[k]}
              </button>
            ))}
          </div>
          <label className="label">{t('sources.name')}</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ margin: '6px 0 12px' }} />
          <label className="label">{kind === 'rss' ? t('sources.url_label') : t('sources.path_label')}</label>
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={kind === 'rss' ? 'https://…/feed.xml' : kind === 'markdown' ? '/path/to/notes' : '/path/to/logs'}
            style={{ margin: '6px 0 14px' }}
          />
          <button className="btn btn-amber-line" onClick={() => void add()} disabled={!name.trim() || !target.trim()}>
            {t('sources.add')}
          </button>
        </Panel>
      </div>

      <Panel style={{ padding: 18, position: 'sticky', top: 0 }}>
        <div className="label" style={{ letterSpacing: '0.08em', fontSize: 11, marginBottom: 16 }}>{t('sources.engine_title')}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
          <span style={{ fontSize: 12.5 }}>{t('sources.cap')}</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--amber)' }}>
            {health?.provider.configured ? health.provider.dailyRequestCap : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
          <span style={{ fontSize: 12.5 }}>{t('sources.token_cap')}</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--dim)' }}>
            {health?.provider.dailyTokenCap ? health.provider.dailyTokenCap.toLocaleString() : t('sources.off_label')}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
          <span style={{ fontSize: 12.5 }}>{t('sources.requests_today')}</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--dim)' }}>
            {health ? `${health.today.requests} · ${health.today.tokens.toLocaleString()} tok` : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
          <span style={{ fontSize: 12.5 }}>{t('sources.pricing')}</span>
          <span className="mono" style={{ fontSize: 11, color: health?.provider.pricingConfigured ? 'var(--amber)' : 'var(--faint)' }}>
            {health?.provider.pricingConfigured ? t('sources.pricing_on') : t('sources.pricing_off')}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
          <span style={{ fontSize: 12.5 }}>{t('sources.models')}</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--dim)', textAlign: 'right' }}>
            {health?.provider.configured && health.provider.models
              ? Object.values(health.provider.models).join(' / ')
              : '—'}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 14, lineHeight: 1.5 }}>{t('sources.engine_note')}</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', marginTop: 14, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)' }}>
          {t('sources.webhook_hint')}
        </div>
      </Panel>
    </div>
  );
}
