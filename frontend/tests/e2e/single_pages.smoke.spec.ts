import { expect, test, type Page } from '@playwright/test';

/**
 * single_pages SPA smoke tests — the root-mounted app post-cutover:
 * /twister + /spoki/ serve the shell, /app/* 301s to the real paths.
 *
 * Prerequisites — all documented in README.md:
 * - `python manage.py runserver` serving this build
 *   (`npm run build` so frontend_dist/manifest.json exists)
 * - a seeded staff user (E2E_USERNAME/E2E_PASSWORD)
 *
 * The unauthenticated specs need nothing beyond the server; the page
 * specs mock /api/single_pages/* at the network layer so no GCS/TTS
 * or spoki.lv access is needed.
 */

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

/** Log in through Django admin — the app itself only offers Google
 *  OAuth at /login/, which e2e cannot complete; the admin session
 *  cookie is the same sessionauth the ninja API checks. Requires a
 *  staff user (admin rejects non-staff credentials). */
async function login(page: Page) {
  await page.goto('/admin/login/');
  await page.getByLabel('Username:').fill(E2E_USERNAME ?? '');
  await page.getByLabel('Password:').fill(E2E_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/admin\//);
}

test.describe('unauthenticated', () => {
  test('/twister and /spoki/ redirect to login (session auth)', async ({
    request,
  }) => {
    // Both pages were public before the React cutover — the bounce
    // to login is a deliberate hardening (the tts endpoint needs a
    // session anyway).
    for (const url of ['/twister', '/spoki/']) {
      const response = await request.get(url, { maxRedirects: 0 });
      expect(response.status()).toBe(302);
      expect(response.headers()['location']).toContain('/login/?next=');
    }
  });

  test('the legacy /app/* strangler mount 301s to the root paths', async ({
    request,
  }) => {
    // app_redirect(base='') — deliberately NOT login-gated, so the
    // SPA's own login bounce happens at the destination.
    const twister = await request.get('/app/twister?x=1', {
      maxRedirects: 0,
    });
    expect(twister.status()).toBe(301);
    expect(twister.headers()['location']).toBe('/twister?x=1');

    for (const url of ['/app', '/app/']) {
      const response = await request.get(url, { maxRedirects: 0 });
      expect(response.status()).toBe(301);
      expect(response.headers()['location']).toBe('/');
    }
  });

  test('no root catch-all: /twister/foo 404s', async ({ request }) => {
    // single_pages mounts at root — only the explicit page routes
    // serve the shell; deep links must 404 rather than shadowing
    // later URLconfs.
    const response = await request.get('/twister/foo', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(404);
  });

  test('the API answers 401 without a session', async ({ request }) => {
    for (const url of [
      '/api/single_pages/spoki/',
      '/api/single_pages/tts/?text=x',
    ]) {
      const response = await request.get(url);
      expect(response.status()).toBe(401);
    }
  });
});

test.describe('authenticated smoke', () => {
  test.beforeEach(() => {
    test.skip(
      !E2E_USERNAME || !E2E_PASSWORD,
      'Set E2E_USERNAME and E2E_PASSWORD to the seeded user ' +
        '(see frontend/README.md).',
    );
  });

  test('twister: form renders and Spēlēt! announces a move', async ({
    page,
  }) => {
    let ttsCalls = 0;
    // A zero-length WAV keeps Chromium's Audio() happy so moves
    // resolve via 'ended' rather than the error path.
    await page.route('**/api/single_pages/tts/**', (route) => {
      ttsCalls += 1;
      route.fulfill({
        json: {
          audio_url:
            'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=',
        },
      });
    });
    await login(page);
    await page.goto('/twister');

    // React mounted with the template's default field values.
    await expect(page.locator('#root')).not.toContainText('Loading React app');
    await expect(
      page.getByRole('textbox', { name: 'Spelētāji 1' }),
    ).toHaveValue('Kārlis');
    await expect(
      page.getByRole('textbox', { name: 'Ķermeņa daļas 1' }),
    ).toHaveValue('Kreisā kāja');

    await page.getByRole('button', { name: 'Spēlēt!' }).click();
    // The current move is announced on screen (audio plays too).
    await expect(page.locator('.current-move')).toBeVisible();
    await expect(page.locator('.current-move')).not.toBeEmpty();
    expect(ttsCalls).toBeGreaterThan(0);
  });

  test('spoki: renders the sanitized article', async ({ page }) => {
    await page.route('**/api/single_pages/spoki/', (route) =>
      route.fulfill({
        json: {
          title: 'Smoke joki',
          html: '<p>smieklīgi</p>',
          source_url: 'https://spoki.lv/joki/x/1',
        },
      }),
    );
    await login(page);
    await page.goto('/spoki/');

    await expect(
      page.getByRole('heading', { name: 'Smoke joki' }),
    ).toBeVisible();
    await expect(page.getByText('smieklīgi')).toBeVisible();
    await expect(page.getByRole('link', { name: /spoki\.lv/ })).toHaveAttribute(
      'href',
      'https://spoki.lv/joki/x/1',
    );
  });
});
