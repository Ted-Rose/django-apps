/**
 * Shared i18next instance — one per SPA entry, initialized in each
 * main.tsx before createRoot. Catalogs are static imports per entry:
 * the `common` namespace ships with shared/, the entry namespace
 * (e.g. 'finance') is that folder's locales/*.json, and the
 * top-level `server` section inside an entry catalog is hoisted into
 * a `server` namespace so API `code` values resolve uniformly as
 * `t(`server:${code}`)`.
 *
 * Language resolution order: `?lang=` dev override → the user's
 * stored preference (spa_shell bootstrap payload) → the
 * `lang_override` localStorage key → navigator.language (via the
 * detector) → 'en' fallback.
 */
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import commonEn from './locales/en.json';
import commonLv from './locales/lv.json';

export const SUPPORTED_LANGUAGES = ['en', 'lv'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const LANG_OVERRIDE_KEY = 'lang_override';

type Catalog = Record<string, unknown>;

function isSupported(lang: unknown): lang is Language {
  return (
    typeof lang === 'string' &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(lang)
  );
}

/** `language` field of the #spa-bootstrap json_script payload. */
function readBootstrapLanguage(): string | undefined {
  const el = document.getElementById('spa-bootstrap');
  if (!el?.textContent) return undefined;
  try {
    const payload = JSON.parse(el.textContent) as { language?: unknown };
    return isSupported(payload.language) ? payload.language : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The language to boot with — undefined lets the detector's
 * navigator step (+ `fallbackLng: 'en'`) decide.
 */
export function bootstrapLanguage(): string | undefined {
  const urlLang = new URLSearchParams(window.location.search).get('lang');
  for (const candidate of [
    urlLang,
    readBootstrapLanguage(),
    localStorage.getItem(LANG_OVERRIDE_KEY),
  ]) {
    if (isSupported(candidate)) return candidate;
  }
  return undefined;
}

/** Split an entry catalog into its app keys and the `server` map. */
export function splitServer(catalog: Catalog): {
  app: Catalog;
  server: Catalog;
} {
  const { server, ...app } = catalog as Catalog & { server?: Catalog };
  return { app, server: server ?? {} };
}

export function initI18n(
  entryNs: string,
  catalogs: { en: Catalog; lv: Catalog },
): typeof i18n {
  const en = splitServer(catalogs.en);
  const lv = splitServer(catalogs.lv);
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        en: { common: commonEn, [entryNs]: en.app, server: en.server },
        lv: { common: commonLv, [entryNs]: lv.app, server: lv.server },
      },
      lng: bootstrapLanguage(),
      fallbackLng: 'en',
      ns: ['common', entryNs, 'server'],
      defaultNS: 'common',
      // Detector handles ONLY the navigator.language fallback step —
      // the stored pref and overrides are resolved explicitly above.
      detection: { order: ['navigator'], caches: [] },
      // lv needs its three plural categories (zero/one/other).
      compatibilityJSON: 'v4',
      interpolation: { escapeValue: false },
    });
  return i18n;
}

/**
 * Resolve an API response body's `code`/`params` to localized text
 * from the `server` namespace, falling back to the English
 * `message`/`detail` the server sent (pass it as `fallback`).
 */
export function serverText(
  data:
    | { code?: string | null; params?: Record<string, unknown> | null }
    | null
    | undefined,
  fallback?: string | null,
): string | undefined {
  const code = data?.code;
  if (typeof code === 'string' && code) {
    const params =
      data?.params && typeof data.params === 'object' ? data.params : {};
    return i18n.t(`server:${code}`, {
      ...params,
      ...(fallback ? { defaultValue: fallback } : {}),
    });
  }
  return fallback ?? undefined;
}

export default i18n;
