import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { splitServer } from '../shared/i18n';
import commonEn from '../shared/locales/en.json';
import commonLv from '../shared/locales/lv.json';
import financeEn from '../finance/locales/en.json';
import financeLv from '../finance/locales/lv.json';
import gmailEn from '../gmail/locales/en.json';
import gmailLv from '../gmail/locales/lv.json';
import tasksEn from '../tasks/locales/en.json';
import tasksLv from '../tasks/locales/lv.json';

// Initialize i18next with the real catalogs synchronously so
// component tests keep asserting on the default English copy. The
// `server` sections are hoisted into the `server` namespace exactly
// like initI18n does per entry; finance's covers the shared codes.
// lv resources are registered too so tests can switchLanguage() into
// Latvian — always switch back to 'en' afterwards.
const financeEnApp = splitServer(financeEn);
const gmailEnApp = splitServer(gmailEn);
const tasksEnApp = splitServer(tasksEn);
const financeLvApp = splitServer(financeLv);
const gmailLvApp = splitServer(gmailLv);
const tasksLvApp = splitServer(tasksLv);
i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: commonEn,
      finance: financeEnApp.app,
      gmail: gmailEnApp.app,
      tasks: tasksEnApp.app,
      server: {
        ...tasksEnApp.server,
        ...financeEnApp.server,
        ...gmailEnApp.server,
      },
    },
    lv: {
      common: commonLv,
      finance: financeLvApp.app,
      gmail: gmailLvApp.app,
      tasks: tasksLvApp.app,
      server: {
        ...tasksLvApp.server,
        ...financeLvApp.server,
        ...gmailLvApp.server,
      },
    },
  },
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'finance', 'gmail', 'tasks', 'server'],
  defaultNS: 'common',
  compatibilityJSON: 'v4',
  interpolation: { escapeValue: false },
});

// Node ≥23 exposes a bare `localStorage` global whose Storage methods
// are inert stubs unless --experimental-webstorage is passed; it ends
// up shadowing jsdom's real implementation. Swap in an in-memory
// shim when the methods are missing so code exercising web storage
// (actionHistory, autosync lastPageLoad) can run under any Node.
function storageShim(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, String(value));
    },
  };
}

if (
  typeof localStorage !== 'undefined' &&
  typeof localStorage.getItem !== 'function'
) {
  const shim = storageShim();
  Object.defineProperty(globalThis, 'localStorage', {
    value: shim,
    configurable: true,
    writable: true,
  });
  if (
    typeof window !== 'undefined' &&
    typeof window.localStorage?.getItem !== 'function'
  ) {
    Object.defineProperty(window, 'localStorage', {
      value: shim,
      configurable: true,
      writable: true,
    });
  }
}

// vitest runs with globals disabled, so register RTL cleanup here.
afterEach(cleanup);
