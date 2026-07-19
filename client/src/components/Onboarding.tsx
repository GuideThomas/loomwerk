import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type Health } from '../api';
import { Panel } from './shared';

// First-run flow, three steps. Honest about what the UI can and cannot do:
// the LLM endpoint is environment-configured (secrets never pass through
// the browser), so step 2 verifies instead of asking.

export default function Onboarding({
  health,
  onDone,
  goSources,
}: {
  health: Health | null;
  onDone: (target: 'run' | 'inbox') => void;
  goSources: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [started, setStarted] = useState(false);
  const steps = t('onboarding.steps', { returnObjects: true }) as string[];
  const providerReady = health?.provider.configured ?? false;
  const hasSources = (health?.sourceCount ?? 0) > 0;

  const startFirstCycle = async () => {
    await api.startCycle();
    setStarted(true);
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{ display: 'flex', marginBottom: 26 }}>
        {steps.map((label, i) => (
          <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ height: 2, background: i <= step ? 'var(--amber)' : 'var(--line-2)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mono" style={{ fontSize: 10, color: i <= step ? 'var(--amber)' : 'var(--faint)' }}>0{i + 1}</span>
              <span style={{ fontSize: 11.5, color: i === step ? 'var(--fg)' : 'var(--dim)' }}>{label}</span>
            </div>
          </div>
        ))}
      </div>

      <Panel style={{ padding: 26 }}>
        {step === 0 && (
          <>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{t('onboarding.connect_title')}</div>
            <div style={{ color: 'var(--dim)', fontSize: 13, margin: '8px 0 20px' }}>{t('onboarding.connect_sub')}</div>
            {hasSources ? (
              <div style={{ border: '1px solid var(--amber)', background: 'var(--amber-soft)', padding: 14 }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--amber)' }}>
                  ✓ {health?.sourceCount} {t('nav.sources')}
                </span>
              </div>
            ) : (
              <button className="btn btn-amber-line" onClick={goSources}>
                → {t('sources.add_title')}
              </button>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{t('onboarding.llm_title')}</div>
            <div style={{ color: 'var(--dim)', fontSize: 13, margin: '8px 0 20px' }}>{t('onboarding.llm_sub')}</div>
            {providerReady ? (
              <div style={{ border: '1px solid var(--amber)', background: 'var(--amber-soft)', padding: 14 }}>
                <div className="mono" style={{ fontSize: 11, color: 'var(--amber)' }}>✓ {t('onboarding.llm_ok')}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', marginTop: 6 }}>
                  {health?.provider.baseUrl} · {Object.values(health?.provider.models ?? {}).join(' / ')}
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 10 }}>{t('onboarding.llm_missing')}</div>
                <pre
                  className="mono"
                  style={{ fontSize: 11.5, background: 'var(--bg)', border: '1px solid var(--line)', padding: 14, overflowX: 'auto', lineHeight: 1.7, margin: 0 }}
                >
{`LOOMWERK_LLM_BASE_URL=https://api.openai.com/v1
LOOMWERK_LLM_API_KEY=sk-…
LOOMWERK_DAILY_LLM_REQUESTS=300`}
                </pre>
              </>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{t('onboarding.demo_title')}</div>
            <div style={{ color: 'var(--dim)', fontSize: 13, margin: '8px 0 20px' }}>{t('onboarding.demo_sub')}</div>
            <button
              className="btn btn-primary"
              style={{ display: 'block', textAlign: 'center', width: '100%', padding: '14px 0', fontSize: 12 }}
              disabled={!providerReady || started}
              onClick={() => void startFirstCycle()}
            >
              {started ? `✓ ${t('run.in_flight')}` : `▶ ${t('onboarding.run_first')}`}
            </button>
            {!providerReady && (
              <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 10 }}>{t('run.no_provider')}</div>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 26, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
          <button
            className="btn"
            style={{ padding: '9px 16px', color: step === 0 ? 'var(--faint)' : 'var(--dim)' }}
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            {t('onboarding.back')}
          </button>
          <button
            className="btn btn-amber-line"
            onClick={() => {
              if (step >= 2) onDone(started ? 'run' : 'inbox');
              else setStep((s) => s + 1);
            }}
          >
            {step >= 2 ? t('onboarding.finish') : t('onboarding.next')}
          </button>
        </div>
      </Panel>
    </div>
  );
}
