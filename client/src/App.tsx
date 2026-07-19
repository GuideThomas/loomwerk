import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setLanguage } from './i18n';

interface Hypothesis {
  id: number;
  statement: string;
  rationale: string | null;
  domain: string | null;
  niche: string | null;
  status: string;
}

// Deliberately plain shell — enough to click through the lifecycle against
// the API. The actual instrument-panel design replaces this in the UI phase.
export default function App() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<Hypothesis[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetch('/api/hypotheses?status=provocation')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);

  const react = async (id: number, signal: string, note?: string) => {
    await fetch(`/api/hypotheses/${id}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signal, note }),
    });
    load();
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-8 flex items-baseline justify-between border-b pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Loomwerk</h1>
          <p className="text-sm text-neutral-500">{t('app.tagline')}</p>
        </div>
        <div className="text-sm">
          <button
            className={i18n.language === 'en' ? 'font-bold' : 'text-neutral-400'}
            onClick={() => setLanguage('en')}
          >
            EN
          </button>
          <span className="mx-1 text-neutral-300">/</span>
          <button
            className={i18n.language === 'de' ? 'font-bold' : 'text-neutral-400'}
            onClick={() => setLanguage('de')}
          >
            DE
          </button>
        </div>
      </header>

      <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-neutral-500">
        {t('nav.provocations')}
      </h2>

      {error && <p className="text-red-600">{t('common.error', { message: error })}</p>}
      {!error && items === null && <p>{t('provocations.loading')}</p>}
      {items !== null && items.length === 0 && (
        <p className="text-neutral-500">{t('provocations.empty')}</p>
      )}

      <ul className="space-y-3">
        {items?.map((h) => (
          <li key={h.id} className="rounded border p-4">
            <div className="mb-1 font-mono text-xs text-neutral-400">
              #{h.id} · {h.domain ?? '—'} {h.niche ? `· ${h.niche}` : ''}
            </div>
            <p className="mb-2">{h.statement}</p>
            {h.rationale && <p className="mb-3 text-sm text-neutral-500">{h.rationale}</p>}
            <div className="flex gap-2 text-sm">
              <button className="rounded border px-2 py-1" onClick={() => react(h.id, 'promoted')}>
                {t('provocations.promote')}
              </button>
              <button
                className="rounded border px-2 py-1"
                onClick={() => {
                  const note = window.prompt(t('provocations.dismissReason')) ?? undefined;
                  void react(h.id, 'dismissed', note);
                }}
              >
                {t('provocations.dismiss')}
              </button>
              <button className="rounded border px-2 py-1" onClick={() => react(h.id, 'loved')}>
                {t('provocations.love')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
