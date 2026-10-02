import { expect, test, type Page } from '@playwright/test';

/**
 * i18n smoke tests (I18N_LATVIAN_PLAN §9): ?lang=lv renders Latvian
 * chrome in both SPAs, and the language switcher round-trips through
 * PATCH /api/me/ so the stored preference survives a reload.
 *
 * Same prerequisites as the other smoke specs: runserver serving the
 * built frontend_dist/ and E2E_USERNAME/E2E_PASSWORD for a seeded
 * staff user.
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

test.describe('i18n smoke', () => {
  test.beforeEach(() => {
    test.skip(
      !E2E_USERNAME || !E2E_PASSWORD,
      'Set E2E_USERNAME and E2E_PASSWORD to the seeded user ' +
        '(see frontend/README.md).',
    );
  });

  test('?lang=lv renders Latvian nav chrome on both SPAs', async ({ page }) => {
    await login(page);
    // ?lang= is a client-side dev override — <html lang> still
    // reflects the stored pref, so assert only rendered copy here.
    await page.goto('/finance/?lang=lv');
    await expect(
      page.getByRole('button', { name: 'Pārslēgt izvēlni' }),
    ).toBeVisible();

    await page.goto('/tasks/?lang=lv');
    await expect(
      page.getByRole('button', { name: 'Pārslēgt izvēlni' }),
    ).toBeVisible();
  });

  test('switcher PATCHes /api/me/ and persists across reloads', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/finance/');

    const patch = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/me/') &&
        response.request().method() === 'PATCH' &&
        response.status() === 200,
    );
    await page.getByRole('button', { name: 'LV' }).click();
    await patch;
    await expect(page.getByText('Konti').first()).toBeVisible();

    // The stored pref wins on reload without ?lang= — the shell's
    // <html lang> follows the bootstrap too.
    await page.goto('/tasks/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'lv');
    await expect(
      page.getByRole('button', { name: 'Pārslēgt izvēlni' }),
    ).toBeVisible();

    // Restore English so the seeded user is left unchanged.
    await page.getByRole('button', { name: 'EN' }).click();
    await expect(
      page.getByRole('button', { name: 'Toggle menu' }),
    ).toBeVisible();
  });
});
