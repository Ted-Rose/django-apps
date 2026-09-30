import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

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
