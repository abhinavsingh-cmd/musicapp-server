import { expect, type Page } from '@playwright/test';

export const BASE = 'http://localhost:3000';

/** The player bar at the bottom of the app. */
export const player = (page: Page) => page.locator('.fixed.bottom-0');

/** Library song rows (SongTable) on any page that renders them. */
export const songRow = (page: Page) => page.locator('.song-row');

/**
 * Wait until the player shows the given icon (play/pause). Tolerates the
 * auto-advance loading state (~15s of spinner when a track ends/changes) and
 * the bounded buffer-stall recovery (~30s of spinner when YouTube throttles
 * a direct stream and the engine falls back to the embedded player). Note:
 * the bar's play/pause icons are driven by store state in EVERY engine mode
 * — the embedded IFrame player itself renders offscreen, so there is no
 * alternate "IFrame mode" UI to wait for.
 */
export async function waitForPlayerIcon(page: Page, name: 'play' | 'pause', timeout = 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const n = await player(page).locator(`svg.lucide-${name}`).count();
    if (n > 0) return;
    if (Date.now() > deadline) {
      throw new Error(`player icon '${name}' never appeared in ${timeout}ms`);
    }
    await page.waitForTimeout(400);
  }
}

/**
 * Wait until the player shows EITHER icon (play or pause) — i.e. it has
 * left the spinner/loading state. Use before toggling so a click is never
 * issued blind into a loading button.
 */
export async function waitForAnyPlayerIcon(page: Page, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const play = await player(page).locator('svg.lucide-play').count();
    const pause = await player(page).locator('svg.lucide-pause').count();
    if (play > 0 || pause > 0) return;
    if (Date.now() > deadline) {
      throw new Error(`player icon (play|pause) never appeared in ${timeout}ms`);
    }
    await page.waitForTimeout(400);
  }
}

/** Log in through the form and wait for the home page to mount. */
export async function login(page: Page) {
  await page.goto(`${BASE}/login`);
  await expect(page.locator('input#email')).toBeVisible();
  await page.fill('input#email', 'e2e-user@example.com');
  await page.fill('input#password', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`);
  await expect(songRow(page).first()).toBeVisible({ timeout: 30_000 });
}
