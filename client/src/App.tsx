import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type Health } from './api';
import { setLanguage } from './i18n';
import Inbox from './components/Inbox';
import Threads from './components/Threads';
import Balance from './components/Balance';
import Sources from './components/Sources';
import RunView from './components/RunView';
import Onboarding from './components/Onboarding';

type Screen = 'inbox' | 'threads' | 'balance' | 'sources' | 'run' | 'onboarding';

const NAV: Array<[Screen, string]> = [
  ['inbox', '01'],
  ['threads', '02'],
  ['balance', '03'],
  ['sources', '04'],
  ['run', '05'],
  ['onboarding', '06'],
];

// Which pipeline stage each screen highlights in the breadcrumb.
const STAGE_MAP: Record<Screen, string | 'all' | null> = {
  inbox: 'provocation',
  threads: 'thread',
  balance: null,
  sources: 'tension',
  run: 'all',
  onboarding: null,
};
const STAGES = ['tension', 'hypothesis', 'provocation', 'thread', 'action'];

// Deep-linkable screens: /?screen=balance opens straight into a view.
function initialScreen(): Screen {
  const q = new URLSearchParams(window.location.search).get('screen');
  return NAV.some(([k]) => k === q) ? (q as Screen) : 'inbox';
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [theme, setTheme] = useState<'dark' | 'light'>(
    (localStorage.getItem('loomwerk.theme') as 'dark' | 'light') ?? 'dark',
  );
  const [health, setHealth] = useState<Health | null>(null);
  const [booted, setBooted] = useState(false);

  const refreshHealth = useCallback(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    api
      .health()
      .then((h) => {
        setHealth(h);
        // Fresh install → start in the setup flow, not an empty inbox
        // (unless a deep link asked for a specific screen).
        if (h.totalHypotheses === 0 && h.sourceCount === 0 && !new URLSearchParams(window.location.search).get('screen')) {
          setScreen('onboarding');
        }
      })
      .catch(() => setHealth(null))
      .finally(() => setBooted(true));
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('loomwerk.theme', next);
  };

  const activeStage = STAGE_MAP[screen];
  const meta = screenMeta(screen, health, t);

  return (
    <div data-theme={theme} style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', display: 'flex' }}>
      <aside style={{ width: 236, flex: '0 0 236px', borderRight: '1px solid var(--line)', background: 'var(--panel)', display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0 }}>
        <div style={{ padding: '20px 18px 18px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 12, height: 12, border: '1.5px solid var(--amber)', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 2.5, background: 'var(--amber)' }} />
            </div>
            <div style={{ fontWeight: 700, letterSpacing: '0.16em', fontSize: 15 }}>LOOMWERK</div>
          </div>
          <div className="label" style={{ marginTop: 8 }}>{t('app.tagline')}</div>
        </div>

        <nav style={{ padding: '10px 0', flex: 1, overflow: 'auto' }}>
          {NAV.map(([key, idx]) => {
            const active = screen === key;
            return (
              <button
                key={key}
                onClick={() => setScreen(key)}
                style={{
                  all: 'unset', boxSizing: 'border-box', width: '100%', cursor: 'pointer',
                  display: 'flex', alignItems: 'baseline', gap: 12, padding: '9px 18px',
                  borderLeft: `2px solid ${active ? 'var(--amber)' : 'transparent'}`,
                  background: active ? 'var(--panel-2)' : 'transparent',
                  color: active ? 'var(--fg)' : 'var(--dim)',
                }}
              >
                <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>{idx}</span>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{t(`nav.${key}`)}</span>
              </button>
            );
          })}
        </nav>

        <div style={{ borderTop: '1px solid var(--line)', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ flex: 1, textAlign: 'center', fontSize: 10, letterSpacing: '0.08em', padding: '7px 0', border: '1px solid var(--line-2)', color: 'var(--dim)' }} onClick={toggleTheme}>
              {theme === 'dark' ? t('common.theme_light') : t('common.theme_dark')}
            </button>
            <div style={{ display: 'flex', border: '1px solid var(--line-2)' }}>
              {(['en', 'de'] as const).map((lang) => {
                const active = i18n.language === lang;
                return (
                  <button
                    key={lang}
                    className="mono"
                    style={{
                      all: 'unset', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 10, padding: '7px 10px',
                      background: active ? 'var(--amber)' : 'transparent',
                      color: active ? 'var(--on-amber)' : 'var(--dim)',
                    }}
                    onClick={() => setLanguage(lang)}
                  >
                    {lang.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.04em', display: 'flex', justifyContent: 'space-between' }}>
            <span>v{health?.version ?? '—'}</span>
            <span>{health?.provider.configured ? t('common.idle').toUpperCase() : 'NO LLM'}</span>
            <span>{health ? `${health.openProvocations}▸` : ''}</span>
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <div className="mono" style={{ display: 'flex', alignItems: 'center', padding: '11px 24px', borderBottom: '1px solid var(--line)', background: 'var(--panel)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {STAGES.map((s, i) => {
            const on = activeStage === 'all' || activeStage === s;
            return (
              <span key={s}>
                <span style={{ color: on ? 'var(--amber)' : 'var(--faint)', fontWeight: on ? 600 : 400 }}>{t(`stages.${s}`)}</span>
                {i < STAGES.length - 1 && <span style={{ color: 'var(--faint)', margin: '0 10px' }}>→</span>}
              </span>
            );
          })}
        </div>

        <div style={{ padding: '20px 24px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '1px solid var(--line)' }}>
          <div>
            <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: '-0.015em', margin: 0 }}>{t(`screens.${screen}.title`)}</h1>
            <p style={{ color: 'var(--dim)', fontSize: 13, margin: '4px 0 0', maxWidth: 560 }}>{t(`screens.${screen}.sub`)}</p>
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', textAlign: 'right', whiteSpace: 'nowrap' }}>{meta}</div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          {booted && (
            <>
              {screen === 'inbox' && <Inbox onChanged={refreshHealth} />}
              {screen === 'threads' && <Threads maxDepth={health?.maxThreadDepth ?? 5} onChanged={refreshHealth} />}
              {screen === 'balance' && <Balance health={health} />}
              {screen === 'sources' && <Sources health={health} onChanged={refreshHealth} />}
              {screen === 'run' && <RunView health={health} onChanged={refreshHealth} />}
              {screen === 'onboarding' && (
                <Onboarding
                  health={health}
                  goSources={() => setScreen('sources')}
                  onDone={(target) => {
                    refreshHealth();
                    setScreen(target);
                  }}
                />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function screenMeta(screen: Screen, health: Health | null, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!health) return '';
  if (screen === 'inbox') return t('common.awaiting', { n: health.openProvocations });
  if (screen === 'sources') return `${health.sourceCount} ${t('nav.sources').toLowerCase()}`;
  return '';
}
