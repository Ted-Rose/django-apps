import { expect, test, type Page } from '@playwright/test';

/**
 * tv_archive SPA smoke tests (post-cutover: the SPA owns
 * /tv-arhivs; load it, apply a filter, change page — plus a check
 * that the legacy /tv-arhivs/app/ mount 301-redirects).
 *
 * Unlike finance/tasks this page is PUBLIC — no login helper, no
 * seeded user. Prerequisites: `python manage.py runserver` serving
 * this build (`npm run build` so frontend_dist/manifest.json
 * exists). The specs assert structural elements only, so they pass
 * against an empty database.
 */

/** Wait until the first contents fetch resolved one way or another
 *  (cards, the empty state, or an error alert replaced the Loading
 *  paragraph). */
async function waitForFeed(page: Page) {
  await expect(page.getByLabel('Loading content')).toBeHidden();
}

test.describe('tv_archive public feed', () => {
  test('the SPA mounts anonymously and renders the feed', async ({ page }) => {
    await page.goto('/tv-arhivs/');
    // React mounted — never the shell's raw placeholder text.
    await expect(page.locator('#root')).not.toContainText('Loading React app');
    await expect(
      page.getByRole('heading', { name: 'TV Archive' }),
    ).toBeVisible();
    // Either content cards or the template's empty state.
    await expect(
      page
        .locator('.feed-card')
        .or(page.getByText('No content available'))
        .first(),
    ).toBeVisible();
    // All nine filter fields rendered.
    await expect(page.getByLabel('Channel:', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Type:')).toBeVisible();
    await expect(page.getByLabel('Min ratio:')).toBeVisible();
  });

  test('submitting the filter form writes params to the URL', async ({
    page,
  }) => {
    await page.goto('/tv-arhivs/');
    await waitForFeed(page);
    // not_channel is a free-text input — works even with an empty DB.
    await page.getByLabel('Not Channel:').fill('e2e-nonexistent');
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page).toHaveURL(/[?&]not_channel=e2e-nonexistent/);
  });

  test('the channel select applies ?channel= when options exist', async ({
    page,
  }) => {
    await page.goto('/tv-arhivs/');
    await waitForFeed(page);
    const select = page.getByLabel('Channel:', { exact: true });
    const optionCount = await select.locator('option').count();
    test.skip(optionCount < 2, 'No channels in the database');
    await select.selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page).toHaveURL(/[?&]channel=.+/);
  });

  test('pagination writes ?page= when more than one page exists', async ({
    page,
  }) => {
    await page.goto('/tv-arhivs/');
    await waitForFeed(page);
    const next = page.getByRole('button', { name: 'Next' });
    test.skip(
      !(await next.isVisible()),
      'Only one page of content in the database',
    );
    await next.click();
    await expect(page).toHaveURL(/[?&]page=2/);
  });

  test('the legacy /tv-arhivs/app/ mount 301-redirects to /tv-arhivs/', async ({
    request,
  }) => {
    const response = await request.get('/tv-arhivs/app/?channel=x', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(301);
    expect(response.headers()['location']).toBe('/tv-arhivs/?channel=x');
  });
});
