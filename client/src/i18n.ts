import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import de from './locales/de.json';

// Language preference is a plain localStorage key — no account, no server
// round trip. Default follows the browser, falling back to English.
const stored = localStorage.getItem('loomwerk.lang');
const initial = stored ?? (navigator.language.startsWith('de') ? 'de' : 'en');

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: 'en' | 'de'): void {
  localStorage.setItem('loomwerk.lang', lang);
  void i18n.changeLanguage(lang);
}

export default i18n;
