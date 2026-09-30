import { expect, test, type Page } from '@playwright/test';

/**
 * google_tasks SPA smoke tests (Stage 5 of the React rewrite plan:
 * load dashboard, complete a mutation round trip, auth bounce).
 *
 * Prerequisites — all documented in README.md:
 * - `python manage.py runserver` serving this build
 *   (`npm run build` so frontend_dist/manifest.json exists)
 * - a seeded staff user (E2E_USERNAME/E2E_PASSWORD) that owns at
 *   least one task row
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
  test('/tasks/app/ redirects to login (session auth)', async ({ request }) => {
    // @login_required → 302 to LOGIN_URL (/login/?next=…); that view
    // then forwards into Google OAuth. Assert the first hop only —
    // the rest depends on accounts.google.com being reachable.
    const response = await request.get('/tasks/app/', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    expect(response.headers()['location']).toContain('/login/?next=');
  });

  test('the API answers 401 without a session', async ({ request }) => {
    const response = await request.get('/api/tasks/dashboard/');
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

  test('login renders the React dashboard', async ({ page }) => {
    await login(page);
    await page.goto('/tasks/app/');
    // React mounted: navbar + either the task list or an
    // empty/auth-state alert (never the raw "Loading React app…").
    await expect(page.locator('nav.navbar').first()).toBeVisible();
    await expect(page.locator('#task-list, .alert').first()).toBeVisible();
    await expect(page.locator('#root')).not.toContainText('Loading React app');
  });

  test('star toggle round-trips through the API', async ({ page }) => {
    await login(page);
    await page.goto('/tasks/app/');
    const star = page.locator('.task-card .star-btn').first();
    await expect(
      star,
      'No task cards rendered — seed the user with at least one ' +
        'task (see frontend/README.md).',
    ).toBeVisible();

    const isStarred = () =>
      star.evaluate((el) => el.classList.contains('starred'));
    const wasStarred = await isStarred();
    const firstPost = page.waitForResponse(
      (response) =>
        /\/api\/tasks\/task\/[^/]+\/toggle-star\//.test(response.url()) &&
        response.status() === 200,
    );
    await star.click();
    await firstPost;
    await expect.poll(isStarred).toBe(!wasStarred);

    // Toggle back so the seeded task is left unchanged.
    const secondPost = page.waitForResponse(
      (response) =>
        /\/api\/tasks\/task\/[^/]+\/toggle-star\//.test(response.url()) &&
        response.status() === 200,
    );
    await star.click();
    await secondPost;
    await expect.poll(isStarred).toBe(wasStarred);
  });
});
