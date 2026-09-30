import { defineConfig, devices } from '@playwright/test';

/**
 * Opt-in Playwright smoke tests — run manually with `npm run test:e2e`
 * (NOT part of `npm test`, the lint/typecheck pipeline, or CI).
 *
 * They drive a REAL Django server — session login, CSRF-protected POSTs
 * and a real database — so `python manage.py runserver` must be running
 * with `frontend_dist/` built and a seeded user. See the "E2E smoke
 * tests" section of README.md for the seed steps.
 *
 * `E2E_BASE_URL` points at another server (default
 * http://localhost:8000); `E2E_USERNAME`/`E2E_PASSWORD` supply the
 * seeded user's credentials.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
