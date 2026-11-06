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

test('a hidden event stays off the feed and its page is not found', async ({ page }) => {
  // The page is found by the id at the end of its URL; the visible event is the control
  await page.goto('/events/sample-yoga-in-the-park-2026-01-01-b0b0b0');
  await expect(page.getByRole('heading', { name: 'Sample Yoga in the Park' })).toBeVisible();

  // The page streams, so it answers 200 with a noindex tag rather than a 404 status
  await page.goto('/events/sample-hidden-event-2026-01-01-a0a0a0');
  await expect(page.getByRole('heading', { name: 'Event Not Found' })).toBeVisible();
  await expect(page.getByText('Sample Hidden Event')).toHaveCount(0);

  await page.goto('/events');
  await expect(eventLink(page, 'Sample Yoga in the Park')).toBeVisible();
  await expect(page.getByText('Sample Hidden Event')).toHaveCount(0);
});
