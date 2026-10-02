import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// One entry per Django app. Output goes to repo-root frontend_dist/,
// which is a STATICFILES_DIRS entry so collectstatic ships it and
// django-vite resolves entries via manifest.json.
export default defineConfig({
  plugins: [react()],
  base: '/static/',
  build: {
    outDir: '../frontend_dist',
    emptyOutDir: true,
    manifest: 'manifest.json',
    rollupOptions: {
      input: {
        tasks: 'src/tasks/main.tsx',
        finance: 'src/finance/main.tsx',
        gmail: 'src/gmail/main.tsx',
        single_pages: 'src/single_pages/main.tsx',
      },
      output: {
        entryFileNames: '[name]/[name].[hash].js',
        chunkFileNames: 'shared/[name].[hash].js',
        assetFileNames: '[name]/[name].[hash][extname]',
      },
    },
  },
  server: {
    // Non-default port so another project's vite on :5173 can't
    // shadow the dev-asset URLs django-vite emits — it must match
    // dev_server_port in django_apps/settings.py (both honor the
    // VITE_PORT env var). strictPort: fail loudly instead of picking
    // a random port Django knows nothing about.
    port: Number(process.env.VITE_PORT) || 5273,
    strictPort: true,
    // Proxy everything to Django EXCEPT Vite-internal paths — both at
    // root (/@react-refresh, /@id/*, /@fs/*, /src/*, /node_modules/*)
    // and under the /static/ base (dev asset URLs are
    // /static/src/*, /static/node_modules/*, /static/@*). Real Django
    // static files under /static/ DO proxy to :8000.
    proxy: {
      '^/(?!@|src/|node_modules/|static/(?:@|src/|node_modules/))':
        'http://localhost:8000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // Playwright smoke specs live outside Vitest — they need a real
    // Django server (see `npm run test:e2e` in package.json).
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
});
