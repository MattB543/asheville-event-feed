import { expect, test, type Page } from '@playwright/test';

// Cards carry hidden copies of the title for other layouts, so match the visible link
const eventLink = (page: Page, title: string) =>
  page.getByRole('link', { name: title }).filter({ visible: true }).first();

test('the events feed lists upcoming events', async ({ page }) => {
  await page.goto('/events');
  await expect(eventLink(page, 'Sample Bluegrass Jam')).toBeVisible();
  await expect(eventLink(page, 'Sample Pottery Class')).toBeVisible();
});

test('searching narrows the feed', async ({ page }) => {
  await page.goto('/events');
  // Search runs on Enter, not as you type
  const search = page.getByPlaceholder('Search events...');
  await search.fill('pottery');
  await search.press('Enter');
  await expect(eventLink(page, 'Sample Pottery Class')).toBeVisible();
  await expect(eventLink(page, 'Sample Bluegrass Jam')).toBeHidden();
});

test('an event opens in the preview, and its own page loads', async ({ page }) => {
  await page.goto('/events');
  const link = eventLink(page, 'Sample Yoga in the Park');
  const href = await link.getAttribute('href');
  await link.click();
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();

  await page.goto(href!);
  await expect(page.getByRole('heading', { name: 'Sample Yoga in the Park' })).toBeVisible();
});
