import { expect, test, type Page } from '@playwright/test';

/**
 * gmail SPA smoke tests (Stage 4 of the google_api React rewrite
 * plan): load /gmail/, submit a query against a mocked API, mark one
 * message read.
 *
 * Prerequisites — all documented in README.md:
 * - `python manage.py runserver` serving this build
 *   (`npm run build` so frontend_dist/manifest.json exists)
 * - a seeded staff user (E2E_USERNAME/E2E_PASSWORD)
 *
 * The unauthenticated specs need nothing beyond the server; the
 * reader specs mock /api/gmail/* at the network layer so no Google
 * credentials are needed.
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

/** Stub the gmail API so the reader runs without Google creds. */
async function mockGmailApi(page: Page) {
  await page.route('**/api/gmail/status/', (route) =>
    route.fulfill({
      json: {
        has_credentials: true,
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      },
    }),
  );
  await page.route('**/api/gmail/messages/**', (route) =>
    route.fulfill({
      json: {
        query: 'is:unread',
        messages: [
          {
            id: 'm1',
            subject: 'Smoke subject',
            sender: 'smoke@example.com',
            body: 'Smoke body',
          },
        ],
      },
    }),
  );
  await page.route('**/api/gmail/mark-read/', (route) =>
    route.fulfill({ json: { success: true } }),
  );
}

test.describe('unauthenticated', () => {
  test('/gmail/ redirects to login (session auth)', async ({ request }) => {
    // @login_required → 302 to LOGIN_URL (/login/?next=…); that view
    // then forwards into Google OAuth. Assert the first hop only —
    // the rest depends on accounts.google.com being reachable.
    const response = await request.get('/gmail/', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    expect(response.headers()['location']).toContain('/login/?next=');
  });

  test('/gmail-to-audio 301s to /gmail/ preserving the query', async ({
    request,
  }) => {
    // Stage 5 cutover: the legacy URL is a permanent redirect —
    // deliberately NOT login-gated, so the SPA's own /login/?next=
    // bounce happens at the destination without a double hop, and
    // ?get_messages&query=… bookmarks auto-fetch in the SPA.
    const response = await request.get(
      '/gmail-to-audio?get_messages&query=is:unread',
      { maxRedirects: 0 },
    );
    expect(response.status()).toBe(301);
    const location = response.headers()['location'];
    expect(location).toContain('/gmail/');
    expect(location).toContain('get_messages');
    expect(location).toContain('query=is%3Aunread');
  });

  test('/gmail-mark-read no longer routes', async ({ request }) => {
    // The mutation's route was deleted at cutover; the view still
    // exists but only /api/gmail/mark-read/ delegates to it.
    const response = await request.post('/gmail-mark-read', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(404);
  });

  test('the API answers 401 without a session', async ({ request }) => {
    const response = await request.get('/api/gmail/status/');
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

  test('query → message list → mark read', async ({ page }) => {
    // The mark-read confirm() dialog must be accepted.
    page.on('dialog', (dialog) => dialog.accept());
    await mockGmailApi(page);
    await login(page);
    await page.goto('/gmail/');

    // React mounted: navbar + filter form (never the raw
    // "Loading React app…").
    await expect(page.locator('nav.navbar').first()).toBeVisible();
    await expect(page.locator('#root')).not.toContainText('Loading React app');

    await page.getByLabel(/Gmail search query/).fill('is:unread');
    await page.getByRole('button', { name: /Get Emails/ }).click();

    await expect(page.getByText('Smoke subject')).toBeVisible();
    await expect(page.getByText('smoke@example.com')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Mark all as read' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Mark as read' }).first().click();
    await expect(
      page.getByRole('button', { name: 'Read' }).first(),
    ).toBeDisabled();
  });
});
