import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type Hypothesis } from '../api';
import { MonoBadge, Panel, ScoreBars, groundingVerdict, tasteLabel } from './shared';

// The provocation inbox — the decisive surface. Three actions, all final:
// Promote (becomes an action), Dismiss (with a reason that trains the
// anti-taste model), Love (pure taste signal).

type LocalState = Record<number, 'promoted' | 'dismissed' | undefined>;

export default function Inbox({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Hypothesis[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variant, setVariant] = useState<'card' | 'row'>('card');
  const [local, setLocal] = useState<LocalState>({});
  const [loved, setLoved] = useState<Record<number, boolean>>({});
  const [dismissingId, setDismissingId] = useState<number | null>(null);

  const load = () => {
    api
      .provocations()
      .then((rows) => setItems(rows))
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);

  const promote = async (id: number) => {
    await api.react(id, 'promoted');
    setLocal((s) => ({ ...s, [id]: 'promoted' }));
    setDismissingId(null);
    onChanged();
  };
  const dismiss = async (id: number, reason: string) => {
    await api.react(id, 'dismissed', reason);
    setLocal((s) => ({ ...s, [id]: 'dismissed' }));
    setDismissingId(null);
    onChanged();
  };
  const love = async (id: number) => {
    if (loved[id]) return;
    await api.react(id, 'loved');
    setLoved((s) => ({ ...s, [id]: true }));
    onChanged();
  };

  if (error) return <p style={{ color: 'var(--amber)' }}>{t('common.error', { message: error })}</p>;
  if (items === null) return <p style={{ color: 'var(--dim)' }}>{t('common.loading')}</p>;

  const visible = items.filter((h) => local[h.id] !== 'dismissed');
  const open = visible.filter((h) => local[h.id] !== 'promoted');
  const reasons = t('inbox.reasons', { returnObjects: true }) as string[];

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', display: 'flex', gap: 18 }}>
          <span>{t('common.open_count', { open: open.length, total: items.length })}</span>
          <span style={{ color: 'var(--amber)' }}>◆ {t('common.taste')}</span>
        </div>
        <div style={{ display: 'flex', border: '1px solid var(--line-2)' }}>
          {(['card', 'row'] as const).map((v) => (
            <button
              key={v}
              className="btn"
              style={{
                padding: '6px 12px',
                fontSize: 10,
                background: variant === v ? 'var(--panel-2)' : 'transparent',
                color: variant === v ? 'var(--fg)' : 'var(--dim)',
              }}
              onClick={() => setVariant(v)}
            >
              {v === 'card' ? t('inbox.view_card') : t('inbox.view_row')}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 && (
        <Panel style={{ padding: '64px 32px', textAlign: 'center' }}>
          <div style={{ width: 36, height: 36, border: '1.5px solid var(--line-2)', margin: '0 auto 20px', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '50%', left: 8, right: 8, height: 1.5, background: 'var(--line-2)' }} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t('inbox.empty_title')}</div>
          <div style={{ color: 'var(--dim)', fontSize: 13, margin: '8px auto 0', maxWidth: 400 }}>{t('inbox.empty_body')}</div>
        </Panel>
      )}

      {variant === 'card' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {visible.map((h) => {
            const isPromoted = local[h.id] === 'promoted' || h.status === 'promoted';
            const isDismissing = dismissingId === h.id;
            const verdict = groundingVerdict(h.grounding_note);
            const taste = tasteLabel(h.score_taste);
            return (
              <Panel key={h.id} style={{ opacity: isPromoted ? 0.72 : 1 }}>
                <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--amber)' }}>
                        {h.niche ?? h.domain ?? '—'}
                      </div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>PRV-{h.id}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '0 0 auto' }}>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', textAlign: 'right' }}>
                        <div style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('common.taste')}</div>
                        <div style={{ color: taste.color, fontSize: 12 }}>{taste.text}</div>
                      </div>
                      {verdict && (
                        <MonoBadge
                          label={verdict === 'confirmed' ? t('inbox.verdict_confirmed') : t('inbox.verdict_refuted')}
                          tone={verdict === 'confirmed' ? 'amber' : 'faint'}
                        />
                      )}
                    </div>
                  </div>

                  <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.01em' }}>{h.statement}</div>
                  {h.rationale && <div style={{ color: 'var(--dim)', fontSize: 13, lineHeight: 1.5 }}>{h.rationale}</div>}
                  <ScoreBars h={h} />
                </div>

                {!isPromoted && isDismissing && (
                  <div style={{ borderTop: '1px solid var(--line)', padding: '12px 18px', background: 'var(--bg)' }}>
                    <div className="label" style={{ marginBottom: 9 }}>{t('inbox.dismiss_prompt')}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                      {reasons.map((r) => (
                        <button
                          key={r}
                          className="btn"
                          style={{ fontFamily: 'inherit', textTransform: 'none', letterSpacing: 0, fontSize: 12, padding: '6px 11px', border: '1px solid var(--line-2)', color: 'var(--dim)' }}
                          onClick={() => void dismiss(h.id, r)}
                        >
                          {r}
                        </button>
                      ))}
                      <button
                        className="btn"
                        style={{ fontFamily: 'inherit', textTransform: 'none', letterSpacing: 0, fontSize: 12, padding: '6px 11px', border: '1px solid var(--line-2)', color: 'var(--dim)' }}
                        onClick={() => {
                          const custom = window.prompt(t('inbox.dismiss_prompt'));
                          if (custom !== null) void dismiss(h.id, custom);
                        }}
                      >
                        {t('inbox.reason_custom')}
                      </button>
                      <button
                        className="btn"
                        style={{ fontFamily: 'inherit', textTransform: 'none', letterSpacing: 0, fontSize: 12, padding: '6px 11px', color: 'var(--faint)' }}
                        onClick={() => setDismissingId(null)}
                      >
                        {t('inbox.reason_cancel')}
                      </button>
                    </div>
                  </div>
                )}

                {!isPromoted && !isDismissing && (
                  <div style={{ borderTop: '1px solid var(--line)', padding: '11px 18px', display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button className="btn btn-primary" onClick={() => void promote(h.id)}>{t('inbox.promote')}</button>
                    <button className="btn btn-ghost" onClick={() => setDismissingId(h.id)}>{t('inbox.dismiss')}</button>
                    <div style={{ flex: 1 }} />
                    <button
                      className="btn"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px',
                        border: `1px solid ${loved[h.id] ? 'var(--amber)' : 'var(--line-2)'}`,
                        color: loved[h.id] ? 'var(--amber)' : 'var(--dim)',
                      }}
                      onClick={() => void love(h.id)}
                    >
                      <span style={{ fontSize: 13 }}>{loved[h.id] ? '♥' : '♡'}</span>
                      {loved[h.id] ? t('inbox.loved') : t('inbox.love')}
                    </button>
                  </div>
                )}

                {isPromoted && (
                  <div style={{ borderTop: '1px solid var(--amber)', padding: '11px 18px', background: 'var(--amber-soft)' }}>
                    <span className="mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--amber)' }}>
                      ✓ {t('inbox.promoted')}
                    </span>
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      {variant === 'row' && visible.length > 0 && (
        <Panel>
          <div
            style={{
              display: 'grid', gridTemplateColumns: '1fr 220px 130px 190px', gap: 16, padding: '9px 16px',
              borderBottom: '1px solid var(--line)',
            }}
            className="label"
          >
            <span>{t('inbox.col_provocation')}</span>
            <span>{t('inbox.col_scores')}</span>
            <span>{t('inbox.col_verdict')}</span>
            <span style={{ textAlign: 'right' }}>{t('inbox.col_action')}</span>
          </div>
          {visible.map((h) => {
            const isPromoted = local[h.id] === 'promoted' || h.status === 'promoted';
            const verdict = groundingVerdict(h.grounding_note);
            return (
              <div
                key={h.id}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 220px 130px 190px', gap: 16, padding: '13px 16px',
                  borderBottom: '1px solid var(--line)', alignItems: 'center', opacity: isPromoted ? 0.72 : 1,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--amber)', marginBottom: 3 }}>
                    {h.niche ?? h.domain ?? '—'}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{h.statement}</div>
                </div>
                <ScoreBars h={h} compact />
                <div>{verdict ? (
                  <MonoBadge
                    label={verdict === 'confirmed' ? t('inbox.verdict_confirmed') : t('inbox.verdict_refuted')}
                    tone={verdict === 'confirmed' ? 'amber' : 'faint'}
                  />
                ) : <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>—</span>}</div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                  {!isPromoted ? (
                    <>
                      <button className="btn btn-primary" style={{ padding: '6px 10px', fontSize: 10 }} onClick={() => void promote(h.id)}>
                        {t('inbox.promote')}
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '6px 10px', fontSize: 10 }}
                        onClick={() => {
                          const custom = window.prompt(t('inbox.dismiss_prompt'));
                          if (custom !== null) void dismiss(h.id, custom);
                        }}
                      >
                        ✕
                      </button>
                      <button
                        className="btn"
                        style={{ fontSize: 12, padding: '5px 9px', border: `1px solid ${loved[h.id] ? 'var(--amber)' : 'var(--line-2)'}`, color: loved[h.id] ? 'var(--amber)' : 'var(--dim)' }}
                        onClick={() => void love(h.id)}
                      >
                        {loved[h.id] ? '♥' : '♡'}
                      </button>
                    </>
                  ) : (
                    <span className="mono" style={{ fontSize: 10, color: 'var(--amber)', textTransform: 'uppercase' }}>✓ {t('inbox.promoted_short')}</span>
                  )}
                </div>
              </div>
            );
          })}
        </Panel>
      )}
    </div>
  );
}
