// Extraction aid for `npx i18next-parser`: scans t()/Trans usage and
// writes discovered keys to locales-extracted/ (gitignored scratch —
// the committed catalogs live in src/<app>/locales/<lng>.json with a
// custom nested layout the parser can't merge into). The enforced
// regression check is `npm run i18n:check` (parity + used-key scan).
export default {
  input: ['src/**/*.{ts,tsx}', '!src/**/*.test.*', '!src/test/**'],
  output: 'locales-extracted/$LOCALE/$NAMESPACE.json',
  locales: ['en', 'lv'],
  defaultNamespace: 'common',
  keySeparator: '.',
  namespaceSeparator: ':',
  createOldCatalogs: false,
  sort: true,
};
