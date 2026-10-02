/**
 * i18n regression check (`npm run i18n:check`):
 *  1. en/lv leaf-key parity per app catalog.
 *  2. Plural trios (*_zero/_one/_other) are complete.
 *  3. Every static `t('key')` / `<Trans i18nKey>` in src resolves
 *     against the catalogs — namespace comes from an `ns:` prefix or
 *     the file's directory (src/<ns> → '<ns>', shared → 'common',
 *     'server' ns = the catalog's top-level `server` section).
 * Exits non-zero on any failure.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function leafKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...leafKeys(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

const catalogs = {};
for (const ns of ['shared', 'finance', 'gmail', 'tasks']) {
  catalogs[ns] = {
    en: readJson(join(SRC, ns, 'locales/en.json')),
    lv: readJson(join(SRC, ns, 'locales/lv.json')),
  };
}
const enSets = {};
for (const [ns, { en }] of Object.entries(catalogs)) {
  enSets[ns] = new Set(leafKeys(en));
}
// The `server` ns = each catalog's top-level `server` section.
const serverKeys = new Set();
for (const { en } of Object.values(catalogs)) {
  for (const k of leafKeys(en.server ?? {}, '')) {
    serverKeys.add(k);
  }
}
// The `common` ns ships from the shared/ catalog.
enSets.common = enSets.shared;
const USE_T = /useTranslation\(\s*['"]([^'"]+)['"]\s*\)/;

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL ${msg}`);
};

// 1+2: parity + plural trios.
for (const [ns, { en, lv }] of Object.entries(catalogs)) {
  const enKeys = leafKeys(en).sort();
  const lvKeys = leafKeys(lv).sort();
  const missing = enKeys.filter((k) => !lvKeys.includes(k));
  const extra = lvKeys.filter((k) => !enKeys.includes(k));
  for (const k of missing) fail(`${ns}: lv missing '${k}'`);
  for (const k of extra) fail(`${ns}: lv has extra '${k}'`);
  for (const suffix of ['_zero', '_one', '_other']) {
    for (const key of enKeys.filter((k) => k.endsWith(suffix))) {
      const stem = key.slice(0, -suffix.length);
      for (const s of ['_zero', '_one', '_other']) {
        if (!enSets[ns].has(stem + s)) {
          fail(`${ns}: incomplete plural trio '${stem}*'`);
        }
      }
    }
  }
}

// 3: static t('…') usage resolves to a catalog key.
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      files.push(p);
    }
  }
})(join(SRC));

const T_CALL = /\bt\(\s*['"`]([^'"`$]+?)['"`]/g;
const TRANS_KEY = /i18nKey=['"]([^'"]+)['"]/g;

function defaultNs(path, source) {
  const m = source.match(USE_T);
  if (m) return m[1];
  const rel = relative(SRC, path).split('/');
  return rel[0] === 'shared' ? 'common' : rel[0];
}

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const fileNs = defaultNs(file, source);
  const calls = [...source.matchAll(T_CALL), ...source.matchAll(TRANS_KEY)];
  for (const [, key] of calls) {
    let leaf = key;
    let candidates = [fileNs, 'common'];
    const m = key.match(/^(common|finance|gmail|tasks|server):(.+)$/);
    if (m) {
      leaf = m[2];
      candidates = [m[1]];
    }
    const hit = candidates.some((ns) => {
      const set = ns === 'server' ? serverKeys : (enSets[ns] ?? new Set());
      // Plural calls select a *_zero/_one/_other sibling at runtime —
      // accept the bare stem or any sibling.
      return (
        set.has(leaf) ||
        ['_zero', '_one', '_other'].some((s) => set.has(leaf + s))
      );
    });
    if (!hit) {
      fail(`${relative(SRC, file)}: '${key}' has no catalog entry`);
    }
  }
}

if (failures) {
  console.error(`\n${failures} i18n check failure(s)`);
  process.exit(1);
}
console.log('i18n check passed: en/lv parity, plural trios, t() keys');
