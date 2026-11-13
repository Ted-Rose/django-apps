import { expect, test, type Page } from '@playwright/test';

/**
 * Unified SPA shell smoke tests — the change this whole change is
 * about: ONE HTML document and ONE React root serve every app, so
 * cross-app navigation is client-side (no document reload).
 *
 * Same prerequisites as the other smoke specs: runserver serving
 * the built frontend_dist/ and E2E_USERNAME/E2E_PASSWORD for a
 * seeded staff user. The unauthenticated specs need only the
 * server.
 */

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

async function login(page: Page) {
  await page.goto('/admin/login/');
  await page.getByLabel('Username:').fill(E2E_USERNAME ?? '');
  await page.getByLabel('Password:').fill(E2E_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/admin\//);
}

test.describe('unauthenticated', () => {
  test('the dashboard is public and the shell is edge-cacheable', async ({
    request,
  }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['cache-control']).toContain('s-maxage=');
    // Edge-cacheable means byte-identical for everyone — the
    // response must never set a cookie.
    expect(headers['set-cookie']).toBeUndefined();
    const html = await response.text();
    // The bootstrap carries only user-agnostic Sentry config;
    // per-user context arrives via GET /api/me/.
    expect(html).toContain('"sentry"');
    expect(html).not.toContain('"user"');
    expect(html).not.toContain('"language"');
    // The single unified entry — never a per-app bundle.
    expect(html).toMatch(/shell\.[A-Za-z0-9_-]+\.js/);
  });

  test('anonymous / renders the dashboard (no login bounce)', async ({
    page,
  }) => {
    await page.goto('/');
    // Public: the card grid renders for everyone; only following
    // a card into an app bounces to login.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Finance').first()).toBeVisible();
  });

  test('a deep link serves the shell then bounces to login', async ({
    page,
  }) => {
    // /login/ 302s straight into Google OAuth — wait for the
    // REQUEST, not the committed URL (the redirect target is
    // external and unreachable in e2e).
    const bounce = page.waitForRequest(/\/login\//);
    const response = await page.goto('/finance/accounts');
    expect(response?.status()).toBe(200);
    const request = await bounce;
    expect(decodeURIComponent(request.url())).toContain(
      'next=/finance/accounts',
    );
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

  test('dashboard → finance → back → tasks: no document reload', async ({
    page,
  }) => {
    // `load` fires only for a real document navigation — never for
    // the history.pushState hops an SPA router performs (unlike
    // `framenavigated`, which reports both).
    let documentLoads = 0;
    page.on('load', () => {
      documentLoads += 1;
    });
    await login(page);
    await page.goto('/');
    await page.waitForLoadState('load');
    documentLoads = 0; // baseline: the / load itself

    // A window-scope marker survives SPA navigation but is wiped
    // by a document reload — the simplest no-reload probe.
    await page.evaluate(() => {
      (window as unknown as { __shellMarker?: string }).__shellMarker =
        'same-document';
    });

    // Card <Link> → client-side mount of the finance chunk
    // (href selectors: labels localize with the user's pref).
    await page.locator('a[href="/finance/"]').first().click();
    await expect(page).toHaveURL(/\/finance\//);
    await expect(page.locator('nav.navbar').first()).toBeVisible();

    // Browser Back = popstate → the shell router restores the
    // dashboard without a document load either.
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.locator('a[href="/tasks/"]').first().click();
    await expect(page).toHaveURL(/\/tasks\//);
    await expect(page.locator('nav.navbar').first()).toBeVisible();

    const marker = await page.evaluate(
      () => (window as unknown as { __shellMarker?: string }).__shellMarker,
    );
    expect(marker).toBe('same-document');
    // Every hop above was client-side — zero document loads since
    // the dashboard first rendered.
    expect(documentLoads).toBe(0);
  });
});
