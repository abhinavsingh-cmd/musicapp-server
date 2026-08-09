import { test, expect, Page } from '@playwright/test';

/**
 * "Human user" deep-interaction checks: click things the way a user does and
 * verify the app actually reacts — playing from multiple surfaces, queue
 * orchestration, context menus, playlist creation, clears, persistence.
 * Requires the dev server running (`npm run dev`).
 */

const BASE = 'http://localhost:3000';

const player = (page: Page) => page.locator('.fixed.bottom-0');
const playerTitle = (page: Page) => player(page).locator('p.text-sm.font-semibold.text-white.truncate').first();

const songRow = (page: Page) => page.locator('.grid.grid-cols-12.group');
const queueRow = (page: Page) => page.locator('.fixed.bottom-28 .flex.items-center.gap-3.px-3.py-2.rounded-xl');
// Table rows render the title as a div, queue/chart rows as a p
const rowTitle = (row: import('@playwright/test').Locator) => row.locator('div.font-medium, p.font-medium').first();

async function waitForPlayerIcon(page: Page, name: 'play' | 'pause', timeout = 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const n = await player(page).locator(`svg.lucide-${name}`).count();
    if (n > 0) return;
    if (Date.now() > deadline) throw new Error(`player icon '${name}' never appeared in ${timeout}ms`);
    await page.waitForTimeout(400);
  }
}

// Poll until the player's song title contains the expected text (playback
// extraction + auto-advance can take a while, so give it a generous window).
async function waitForPlayerTitle(page: Page, expected: string, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const t = await playerTitle(page).textContent().catch(() => '');
    if (t && (t === expected || t.includes(expected) || expected.includes(t as string))) return;
    if (Date.now() > deadline) {
      throw new Error(`player title never became '${expected}' (last: '${t}')`);
    }
    await page.waitForTimeout(400);
  }
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.fill('input#email', 'e2e-user@example.com');
  await page.fill('input#password', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`);
  await expect(songRow(page).first()).toBeVisible({ timeout: 30_000 });
}

function normalized(s: string) {
  return s.replace(/\s+/g, ' ').trim();
}

test.describe.configure({ mode: 'serial' });

test.setTimeout(600_000);

test('human flows: play from search/charts/discover, queue ops, menus, playlists, settings, clears', async ({ page }) => {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('requestfailed', (r) => {
    const u = r.url();
    const err = r.failure()?.errorText ?? '';
    // Aborted requests are expected: switching songs/navigating mid-load
    // cancels stale audio/thumbnail streams by design.
    if (/googleads|doubleclick|ytimg/.test(u)) return;
    if (/ERR_ABORTED|aborted/i.test(err)) return;
    failedRequests.push(`${u} :: ${err}`);
  });

  await test.step('1. login', async () => {
    await login(page);
    console.log('[Login] OK');
  });

  await test.step('2. search for a song and play the first result', async () => {
    await page.goto(`${BASE}/search`);
    const input = page.locator('input[placeholder*="Search"]').first();
    await expect(input).toBeVisible();
    await input.fill('Pushpa');
    await expect(songRow(page).first()).toBeVisible({ timeout: 20_000 });
    const title = await rowTitle(songRow(page).first()).textContent();
    await songRow(page).first().click();
    await waitForPlayerIcon(page, 'pause');
    await waitForPlayerTitle(page, normalized(title ?? ''));
    console.log(`[Search] played first result: "${title}"`);
  });

  await test.step('3. queue: play a different row from the queue', async () => {
    await player(page).locator('[title="Queue"]').click();
    const rows = queueRow(page);
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count, 'queue should have upcoming rows').toBeGreaterThan(1);
    const target = rows.nth(1);
    const want = await rowTitle(target).textContent();
    await target.click();
    await waitForPlayerIcon(page, 'pause');
    await waitForPlayerTitle(page, normalized(want ?? ''));
    console.log(`  queue row → played: "${want}" (${count} rows)`);
  });

  await test.step('4. queue: remove one row', async () => {
    const rows = queueRow(page);
    const before = await rows.count();
    await rows.nth(1).hover();
    await rows.nth(1).locator('svg.lucide-x').click();
    await page.waitForTimeout(500);
    const after = await rows.count();
    expect(after, 'queue row should be removed').toBeLessThan(before);
    console.log(`  remove: ${before} → ${after}`);
  });

  await test.step('5. queue: clear queue', async () => {
    await page.locator('.fixed.bottom-28 [title="Clear Queue"]').click();
    await page.waitForTimeout(500);
    const rows = queueRow(page);
    const remaining = await rows.count();
    // current + recent sections may persist — upcoming rows should be gone
    console.log(`[Clear Queue] rows left: ${remaining}`);
    expect(remaining).toBeLessThanOrEqual(1);
  });
  await player(page).locator('[title="Queue"]').click();

  await test.step('6. context menu on a library row', async () => {
    await page.goto(`${BASE}/library`);
    await expect(songRow(page).first()).toBeVisible();
    const row = songRow(page).first();
    await row.click({ button: 'right' });
    const menu = page.locator('[role="menu"], .fixed.inset-0.z-\\[100\\]');
    await expect(menu.first()).toBeVisible();
    for (const action of ['Play', 'Queue', 'Favorite', 'Share', 'Download']) {
      const n = await page.getByText(action, { exact: false }).count();
      console.log(`[ContextMenu] "${action}": ${n}`);
    }
    await page.mouse.click(10, 10);
    await page.waitForTimeout(300);
  });

  await test.step('7. charts: click a ranked row to play', async () => {
    await page.goto(`${BASE}/charts`);
    const rows = page.locator('.rounded-xl.group.cursor-pointer');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const target = rows.nth(1);
    const want = await rowTitle(target).textContent();
    await target.click();
    await waitForPlayerIcon(page, 'pause');
    await waitForPlayerTitle(page, normalized(want ?? ''));
    console.log(`[Charts] played: "${want}"`);
  });

  await test.step('8. discover: pick a genre, play a pick', async () => {
    await page.goto(`${BASE}/discover`);
    const chips = page.locator('button').filter({ hasText: /\(\d+\)$/ });
    await expect(chips.first()).toBeVisible({ timeout: 30_000 });
    const label = await chips.first().textContent();
    await chips.first().click();
    await expect(page.getByText(label ?? '!!', { exact: false }).first()).toBeVisible();
    await expect(songRow(page).first()).toBeVisible();
    const title = await rowTitle(songRow(page).first()).textContent();
    await songRow(page).first().click();
    await waitForPlayerIcon(page, 'pause');
    await waitForPlayerTitle(page, normalized(title ?? ''));
    console.log(`[Discover] chip "${label}" → played "${title}"`);
  });

  await test.step('9. favorites: heart current song, see it on the favorites page', async () => {
    const heart = player(page).locator('button').filter({ has: page.locator('svg.lucide-heart') });
    if ((await heart.locator('svg').getAttribute('fill')) !== 'currentColor') await heart.click();
    await page.goto(`${BASE}/favorites`);
    await expect(page.getByText('No favorites yet', { exact: false }).or(songRow(page).first())).toBeVisible({ timeout: 30_000 });
    expect(await songRow(page).count()).toBeGreaterThan(0);
    const favTitle = await rowTitle(songRow(page).first()).textContent();
    await songRow(page).first().click();
    await waitForPlayerIcon(page, 'pause');
    await waitForPlayerTitle(page, normalized(favTitle ?? ''));
    console.log(`[Favorites] row → played "${favTitle}"`);
  });

  await test.step('10. history: plays recorded, clear works', async () => {
    await page.goto(`${BASE}/history`);
    const clearBtn = page.getByRole('button', { name: /Clear History/ });
    await expect(clearBtn).toBeVisible({ timeout: 30_000 });
    await clearBtn.click();
    await expect(page.getByText('No listening history')).toBeVisible({ timeout: 10_000 });
    console.log('[History] cleared, empty state shown');
  });

  await test.step('11. playlist: create and see it', async () => {
    await page.goto(`${BASE}/create-playlist`);
    await page.fill('input[placeholder="My Playlist"]', 'Road Trip Picks');
    await page.fill('textarea[placeholder*="description"]', 'made by the e2e user');
    const submit = page.getByRole('button', { name: /Create Playlist|Save/i }).first();
    await expect(submit).toBeVisible();
    await submit.click();
    await page.waitForTimeout(1500);
    await page.goto(`${BASE}/library`);
    const tabBtn = page.locator('button').filter({ hasText: 'Playlists' }).first();
    await tabBtn.click();
    await expect(page.getByText('Road Trip Picks').first()).toBeVisible({ timeout: 15_000 });
    console.log('[Playlist] created + listed in library');
  });

  await test.step('12. settings: autoplay toggle persists across reload', async () => {
    await page.goto(`${BASE}/settings`);
    const toggle = page.locator('button[aria-label="Enable autoplay"], button[aria-label="Disable autoplay"]');
    await expect(toggle.first()).toBeVisible({ timeout: 15_000 });
    await toggle.first().click();
    await page.waitForTimeout(1500); // store persists after a 500ms debounce
    const after = (await toggle.first().getAttribute('aria-label')) === 'Disable autoplay' ? 'on' : 'off';
    await page.reload();
    const reloaded = page.locator('button[aria-label="Enable autoplay"], button[aria-label="Disable autoplay"]');
    await expect(reloaded.first()).toBeVisible();
    const label = await reloaded.first().getAttribute('aria-label');
    expect(label === 'Disable autoplay' ? 'on' : 'off', 'autoplay should persist after reload').toBe(after);
    console.log(`[Settings] autoplay persisted (${after})`);
  });

  await test.step('13. downloads: page renders queue sections without crashing', async () => {
    await page.goto(`${BASE}/downloads`);
    await expect(page.getByRole('heading', { name: /Downloads/ })).toBeVisible();
    const text = normalized(await page.locator('main, body').last().textContent() ?? '');
    expect(/(Downloading|Download Queue|Downloaded|No downloads)/.test(text)).toBeTruthy();
    console.log('[Downloads] page renders');
  });

  await test.step('14. errors collected', async () => {
    console.log(`[Errors] pageErrors=${pageErrors.length} failedRequests=${failedRequests.length}`);
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(failedRequests, `failed requests: ${failedRequests.join(' | ')}`).toEqual([]);
  });
});