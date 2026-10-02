import { describe, expect, it } from 'vitest';

import commonEn from './locales/en.json';
import commonLv from './locales/lv.json';
import financeEn from '../finance/locales/en.json';
import financeLv from '../finance/locales/lv.json';
import tasksEn from '../tasks/locales/en.json';
import tasksLv from '../tasks/locales/lv.json';
import { serverText } from './i18n';

type Catalog = Record<string, unknown>;

/** Flatten a catalog to dotted leaf paths; arrays count as leaves. */
function leafKeys(obj: Catalog, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...leafKeys(v as Catalog, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

const PLURAL_SUFFIXES = ['_zero', '_one', '_other'];

const CATALOGS: [string, Catalog, Catalog][] = [
  ['common', commonEn, commonLv],
  ['finance', financeEn, financeLv],
  ['tasks', tasksEn, tasksLv],
];

describe('locale catalogs', () => {
  for (const [name, en, lv] of CATALOGS) {
    it(`${name}: en and lv key sets are identical`, () => {
      expect(leafKeys(lv).sort()).toEqual(leafKeys(en).sort());
    });
  }

  it('every plural key carries the full lv sibling set', () => {
    // lv needs zero/one/other; en files carry _zero too for parity.
    for (const [name, en] of CATALOGS) {
      const keys = new Set(leafKeys(en));
      for (const key of keys) {
        for (const suffix of PLURAL_SUFFIXES) {
          if (key.endsWith(suffix)) {
            const stem = key.slice(0, -suffix.length);
            for (const s of PLURAL_SUFFIXES) {
              expect(keys.has(stem + s), `${name}:${stem}${s}`).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe('serverText', () => {
  it('resolves a code through the server namespace', () => {
    expect(
      serverText(
        { code: 'categorySaved', params: { name: 'Food' } },
        'fallback',
      ),
    ).toBe('Category "Food" saved.');
  });

  it('falls back to the server detail for unmapped codes', () => {
    expect(serverText({ code: 'nope' }, 'English detail')).toBe(
      'English detail',
    );
    expect(serverText(null, 'English detail')).toBe('English detail');
  });
});
