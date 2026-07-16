import { test, expect } from '@playwright/test';

test('full test: songs, UI, playback, navigation', async ({ page }) => {
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('console', msg => { if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text()); });

  await page.goto('http://localhost:3000');
  await page.fill('input[type="email"]', 'test@test.com');
  await page.fill('input[type="password"]', 'password');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  // Check song rows exist (virtual scrolling - only visible rows rendered)
  const allSongRows = page.locator('.grid.grid-cols-12.group');
  const totalCount = await allSongRows.count();
  console.log(`Visible song rows: ${totalCount}`);
  expect(totalCount).toBeGreaterThan(10);

  // Check player exists
  await expect(page.locator('.fixed.bottom-0')).toBeVisible();
  await expect(page.locator('#yt-player-container')).toBeAttached();

  // Click a song and verify it loads
  await allSongRows.first().click();
  await page.waitForTimeout(4000);

  const songText = await page.locator('.fixed.bottom-0 p').first().textContent();
  console.log(`Playing: ${songText}`);
  expect(songText).not.toBe('No song selected');
  expect(songText).not.toBeNull();

  // Test navigation - Search
  await page.click('a[href="/search"]');
  await page.waitForTimeout(1000);
  await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
  console.log('Search page: OK');

  // Test navigation - Discover
  await page.click('a[href="/discover"]');
  await page.waitForTimeout(2000);
  await expect(page.locator('h2:has-text("Discover")').first()).toBeAttached({ timeout: 10000 });
  console.log('Discover page: OK');

  // Test navigation - Favorites
  await page.click('a[href="/favorites"]');
  await page.waitForTimeout(1000);
  await expect(page.getByRole('heading', { name: /Favorites/ })).toBeAttached();
  console.log('Favorites page: OK');

  // Test navigation - Library
  await page.click('a[href="/library"]');
  await page.waitForTimeout(1000);
  await expect(page.getByRole('heading', { name: /songs/ })).toBeAttached();
  console.log('Library page: OK');

  // Test header search button
  await page.locator('button:has(svg path[d*="M21 21l-6-6m2-5a7 7 0 11-14 0"])').click({ force: true });
  await page.waitForTimeout(1000);
  await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
  console.log('Header search button: OK');

  console.log('ALL CHECKS PASSED');
});
