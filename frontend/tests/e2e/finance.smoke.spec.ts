import { expect, test, type Page } from '@playwright/test';

/**
 * finance SPA smoke tests (Stage 5 of the React rewrite plan:
 * load /finance/, navigate to transactions, open the rules
 * drawer).
 *
 * Prerequisites — all documented in README.md:
 * - `python manage.py runserver` serving this build
 *   (`npm run build` so frontend_dist/manifest.json exists)
 * - a seeded staff user (E2E_USERNAME/E2E_PASSWORD)
 *
 * The unauthenticated specs need nothing beyond the server.
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
  test('/finance/ serves the shell then bounces to login', async ({ page }) => {
    // The unified shell is public + edge-cached: anonymous deep
    // links get 200 HTML, then the /api/me/ bootstrap 401 navigates
    // the client to /login/?next=<deep link>. Wait for the request —
    // /login/ 302s to an external OAuth provider e2e can't reach.
    const bounce = page.waitForRequest(/\/login\//);
    const response = await page.goto('/finance/');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['cache-control']).toContain('s-maxage=');
    const request = await bounce;
    expect(decodeURIComponent(request.url())).toContain('next=');
  });

  test('the API answers 401 without a session', async ({ request }) => {
    const response = await request.get('/api/finance/accounts/');
    expect(response.status()).toBe(401);
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

  test('login renders the accounts page', async ({ page }) => {
    await login(page);
    await page.goto('/finance/?lang=en');
    // `/` inside the SPA redirects to /accounts.
    await expect(page).toHaveURL(/\/finance\/accounts/);
    // React mounted: navbar + either the account list or an
    // empty-state alert (never the raw "Loading React app…").
    await expect(page.locator('nav.navbar').first()).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Accounts', exact: true }),
    ).toBeVisible();
    await expect(page.locator('#root')).not.toContainText('Loading React app');
  });

  test('navigates to transactions via the nav links', async ({ page }) => {
    await login(page);
    // ?lang=en pins English copy regardless of the stored pref.
    await page.goto('/finance/accounts?lang=en');
    // The burger items render inline on desktop (the toggle only
    // appears below 768px) — click the visible Transactions link.
    await page
      .getByRole('link', { name: 'Transactions', exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/finance\/transactions/);
    await expect(
      page.getByRole('heading', { name: 'Transactions' }),
    ).toBeVisible();
  });

  test('rules page opens the rule drawer', async ({ page }) => {
    await login(page);
    await page.goto('/finance/rules');
    await expect(
      page.getByRole('heading', { name: 'Categorization Rules' }),
    ).toBeVisible();

    // "New rule" needs at least one category — create an
    // idempotent one when the seed user has none (the API
    // update_or_creates on (user, name)).
    const newRule = page.getByRole('button', { name: /New rule/ });
    if (await newRule.isDisabled()) {
      await page.getByLabel('Name').fill('E2E smoke');
      await page.getByRole('button', { name: 'Add' }).click();
      await expect(newRule).toBeEnabled();
    }
    await newRule.click();
    const drawer = page.getByTestId('rule-drawer');
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole('heading', { name: 'New rule' }),
    ).toBeVisible();
  });
});
