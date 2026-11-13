/**
 * Shared i18next instance — ONE for the whole unified shell.
 * `initI18n` runs once in the shell entry with the `common`
 * catalog; each app's lazy module calls `registerI18n` at chunk
 * evaluation (before its components render) to add its own
 * namespace — so translations follow the chunk, not the entry.
 * The top-level `server` section inside an app catalog is merged
 * into a shared `server` namespace so API `code` values resolve
 * uniformly as `t(`server:${code}`)` from any app.
 *
 * Language resolution order: `?lang=` dev override → the user's
 * stored preference (applied via `changeLanguage` once the
 * /api/me bootstrap lands — see `shared/session.tsx`) → the
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

export function isSupportedLanguage(lang: unknown): lang is Language {
  return (
    typeof lang === 'string' &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(lang)
  );
}

/**
 * The language to boot with — undefined lets the detector's
 * navigator step (+ `fallbackLng: 'en'`) decide; the stored
 * per-user pref is applied later via `changeLanguage` when the
 * session bootstrap resolves.
 */
export function bootstrapLanguage(): string | undefined {
  const urlLang = new URLSearchParams(window.location.search).get('lang');
  for (const candidate of [urlLang, localStorage.getItem(LANG_OVERRIDE_KEY)]) {
    if (isSupportedLanguage(candidate)) return candidate;
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

/**
 * Initializes the shared instance with the `common` catalog —
 * called once in the shell entry before `createRoot`.
 */
export function initI18n(): typeof i18n {
  // The edge-cached HTML is a static lang="en" — keep the attribute
  // in sync as every language source (detector, session pref,
  // switcher, ?lang=) funnels through changeLanguage.
  i18n.on('languageChanged', (lng) => {
    document.documentElement.lang = lng;
  });
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        en: { common: commonEn },
        lv: { common: commonLv },
      },
      lng: bootstrapLanguage(),
      fallbackLng: 'en',
      ns: ['common'],
      defaultNS: 'common',
      // Detector handles ONLY the navigator.language fallback step —
      // the stored pref and overrides are resolved explicitly.
      detection: { order: ['navigator'], caches: [] },
      // lv needs its three plural categories (zero/one/other).
      compatibilityJSON: 'v4',
      interpolation: { escapeValue: false },
    });
  document.documentElement.lang = i18n.language || 'en';
  return i18n;
}

/**
 * Registers one app's catalogs on the shared instance — called at
 * lazy-chunk evaluation in each app's main.tsx, before its
 * components render. `deep`/`overwrite` merge flags let every app
 * contribute to the shared `server` namespace without clobbering
 * keys another chunk already added.
 */
export function registerI18n(
  ns: string,
  catalogs: { en: Catalog; lv: Catalog },
): void {
  const en = splitServer(catalogs.en);
  const lv = splitServer(catalogs.lv);
  i18n.addResourceBundle('en', ns, en.app, true, true);
  i18n.addResourceBundle('lv', ns, lv.app, true, true);
  i18n.addResourceBundle('en', 'server', en.server, true, true);
  i18n.addResourceBundle('lv', 'server', lv.server, true, true);
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
