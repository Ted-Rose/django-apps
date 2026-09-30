import { defineConfig } from 'vite';
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
      input: { tasks: 'src/tasks/main.tsx' },
      output: {
        entryFileNames: '[name]/[name].[hash].js',
        chunkFileNames: 'shared/[name].[hash].js',
        assetFileNames: '[name]/[name].[hash][extname]',
      },
    },
  },
  server: {
    proxy: {
      '^/(?!static/|@vite|src/|node_modules/)': 'http://localhost:8000',
    },
  },
});
