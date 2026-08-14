import { test, expect, Page } from '@playwright/test';

/**
 * Full user-style E2E journey: login → home → every player control → queue →
 * lyrics → equalizer → shortcuts → every page/form → 404. Requires the dev
 * server running (`npm run dev`: vite :3000, api :3001).
 */

const BASE = 'http://localhost:3000';

const player = (page: Page) => page.locator('.fixed.bottom-0');

// Wait until the player shows the given icon (play/pause). Tolerates the
// auto-advance loading state (~15s of spinner when a track ends/changes).
async function waitForPlayerIcon(page: Page, name: 'play' | 'pause', timeout = 60_000) {
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

const songRow = (page: Page) => page.locator('.grid.grid-cols-12.group');

async function login(page: Page) {
  await page.goto(`${BASE}/login`);
  await expect(page.locator('input#email')).toBeVisible();
  await page.fill('input#email', 'e2e-user@example.com');
  await page.fill('input#password', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`);
  // wait for the content area to mount
  await expect(songRow(page).first()).toBeVisible({ timeout: 30000 });
}

async function openPanel(page: Page, title: string) {
  await player(page).locator(`[title="${title}"]`).click();
  await expect(player(page).locator(`[title="${title}"]`)).toBeVisible();
}

async function closePanel(page: Page, title: string) {
  await player(page).locator(`[title="${title}"]`).click();
}

test.describe.configure({ mode: 'serial' });

test('full user journey (desktop)', async ({ page }) => {
  test.setTimeout(7 * 60_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });

  // ── 1. LOGIN ───────────────────────────────────────────────────────────────
  await test.step('1. login + home renders', async () => {
    await login(page);
    const rows = await songRow(page).count();
    console.log(`[Home] song rows: ${rows}`);
    expect(rows).toBeGreaterThan(0);
    await expect(player(page)).toBeVisible();
  });

  // ── 2. PLAYBACK ────────────────────────────────────────────────────────────
  await test.step('2. pick a song and confirm it loads', async () => {
    await songRow(page).first().click();
    await page.waitForTimeout(2500);
    const title = await player(page).locator('p').first().textContent();
    console.log(`[Playback] song: ${title?.trim()}`);
    expect(title?.trim()).toBeTruthy();
    expect(title).not.toContain('No song selected');
    await expect(player(page).locator('.font-mono').first()).toBeVisible();
  });

  await test.step('3. progress bar seek', async () => {
    await page.waitForTimeout(2000);
    const bar = player(page).locator('div.relative.h-1\\.5.bg-white\\/10');
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    if (box) {
      // Seek shallow (5%) so the track doesn't end mid-test
      await page.mouse.click(box.x + box.width * 0.05, box.y + box.height / 2);
      await page.waitForTimeout(800);
    }
    const time = await player(page).locator('.font-mono').first().textContent();
    console.log(`[Progress] time shown: ${time}`);
    expect(time).toMatch(/^\d+:\d\d$/);
  });

  await test.step('4. play / pause toggle', async () => {
    const p = player(page);
    // Normalize to a loaded-paused state first (auto-advance may be mid-load)
    if ((await p.locator('svg.lucide-pause').count()) > 0) {
      await p.locator('button:has(svg.lucide-pause)').click();
    }
    await waitForPlayerIcon(page, 'play');
    console.log('[Controls] normalized to paused');

    await p.locator('button:has(svg.lucide-play)').click();
    await waitForPlayerIcon(page, 'pause');
    console.log('[Controls] play → playing');
    await p.locator('button:has(svg.lucide-pause)').click();
    await waitForPlayerIcon(page, 'play');
    await p.locator('button:has(svg.lucide-play)').click();
    await waitForPlayerIcon(page, 'pause');
    console.log('[Controls] pause → play OK');
  });

  await test.step('5. next / previous', async () => {
    const queueState = () =>
      page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('playback-queue') || 'null'); }
        catch { return null; }
      });
    const q0 = await queueState();
    const before = await player(page).locator('p').first().textContent();

    await player(page).locator('button:has(svg.lucide-skip-forward)').click();
    let after = before;
    const spinHistory: number[] = [];
    for (let i = 0; i < 18 && after === before; i++) {
      await page.waitForTimeout(800);
      spinHistory.push(await player(page).locator('svg.animate-spin').count());
      after = await player(page).locator('p').first().textContent();
    }
    const q1 = await queueState();
    console.log(`[Next] "${before?.trim()}" → "${after?.trim()}" (queue ${q0?.queue?.length}→${q1?.queue?.length} idx ${q0?.currentIndex}→${q1?.currentIndex}, spinners ${spinHistory.slice(0, 6)})`);
    expect(after, `skip-forward should change track (queue idx ${q0?.currentIndex} → ${q1?.currentIndex})`).not.toBe(before);

    const beforeP = await player(page).locator('p').first().textContent();
    await player(page).locator('button:has(svg.lucide-skip-back)').click();
    let afterP = beforeP;
    for (let i = 0; i < 18 && afterP === beforeP; i++) {
      await page.waitForTimeout(800);
      afterP = await player(page).locator('p').first().textContent();
    }
    console.log(`[Prev]: "${beforeP?.trim()}" → "${afterP?.trim()}"`);
    expect(afterP).not.toBe(beforeP);
  });

  await test.step('6. shuffle + repeat cycle', async () => {
    const shuffleBtn = player(page).locator('[title="Shuffle Off"],[title="Shuffle On"]');
    await shuffleBtn.first().click();
    await expect(player(page).locator('[title="Shuffle On"]')).toBeVisible({ timeout: 5000 });
    console.log('[Shuffle] toggled ON');
    const titles: string[] = [];
    for (let i = 0; i < 3; i++) {
      const b = player(page).locator('[title^="Repeat:"]');
      await b.click();
      titles.push((await b.getAttribute('title')) || '');
    }
    console.log(`[Repeat] cycle: ${titles.join(' → ')}`);
    expect(new Set(titles).size).toBeGreaterThan(1);
  });

  await test.step('7. volume slider', async () => {
    const vol = player(page).locator('input[type="range"]').first();
    await vol.fill('0');
    await page.waitForTimeout(300);
    const v = await vol.inputValue();
    console.log(`[Volume] set to ${v}`);
    await vol.fill('0.7');
  });

  await test.step('8. favorite heart', async () => {
    const heartBtn = player(page).locator('button:has(svg.lucide-heart)');
    await expect(heartBtn).toBeVisible();
    await heartBtn.click();
    await page.waitForTimeout(400);
    const fill = await heartBtn.locator('svg').getAttribute('fill');
    console.log(`[Favorite] heart fill after click: ${fill}`);
    expect(fill).toBe('currentColor');
  });

  await test.step('9. download button', async () => {
    const dl = player(page).locator('[title="Download"],[title="Cancel download"]');
    if ((await dl.count()) === 0) {
      console.log('[Download] already downloaded via state');
    } else {
      await dl.first().click();
      await page.waitForTimeout(8000);
      const cancelledOrDone = await player(page).locator('[title="Cancel download"],[title="Downloaded"]');
      const state = (await cancelledOrDone.count()) > 0 ? 'started/finished' : 'unknown';
      console.log(`[Download] clicked, state after 8s: ${state}`);
    }
  });

  // ── 3. QUEUE ───────────────────────────────────────────────────────────────
  await test.step('10. queue panel', async () => {
    await openPanel(page, 'Queue');
    const q = page.locator('.fixed.bottom-28');
    await expect(q).toBeVisible();
    await expect(q.getByText('Queue', { exact: true })).toBeVisible();
    console.log('[Queue] panel opened');
    await closePanel(page, 'Queue');
  });

  // ── 4. LYRICS ──────────────────────────────────────────────────────────────
  await test.step('11. lyrics panel', async () => {
    await openPanel(page, 'Lyrics');
    const panel = page.locator('.fixed.bottom-28');
    await expect(panel.getByText('Lyrics', { exact: true })).toBeVisible();
    await page.waitForTimeout(8000);
    const hasLines = await panel.locator('.cursor-pointer.hover\\:bg-white\\/5').count();
    const empty = await panel.getByText('No lyrics available').isVisible();
    const stillLoading = await panel.getByText('Loading lyrics...').isVisible();
    console.log(`[Lyrics] lines=${hasLines} empty=${empty} stuckLoading=${stillLoading}`);
    expect(empty || hasLines > 0, `lyrics should resolve (stuck loading=${stillLoading})`).toBeTruthy();
    await closePanel(page, 'Lyrics');
  });

  // ── 5. EQUALIZER ───────────────────────────────────────────────────────────
  await test.step('12. equalizer panel: presets, bands, toggles, persistence', async () => {
    await page.evaluate(() => localStorage.removeItem('audio_effects_v1'));
    await openPanel(page, 'Equalizer');
    await expect(page.getByRole('heading', { name: 'Audio Effects' })).toBeVisible();

    for (const preset of ['Flat', 'Bass Boost', 'Treble Boost', 'Rock', 'Classical', 'Jazz', 'Hip Hop', 'Electronic', 'Vocal', 'Pop']) {
      await expect(page.getByRole('button', { name: preset })).toBeVisible();
    }
    console.log('[EQ] all 10 presets rendered');

    // 10 band sliders + 3 extra sliders live in the panel, not the player bar
    const panel = page.locator('.fixed.bottom-28');
    const ranges = panel.locator('input[type="range"]');
    console.log(`[EQ] range inputs: ${await ranges.count()}`);
    expect(await ranges.count()).toBeGreaterThanOrEqual(13);

    // power toggle: sliders start disabled (default off) → click → enabled
    const powerBtn = page.locator('button:has(svg.lucide-power)');
    await powerBtn.click();
    await page.waitForTimeout(500);
    let store = await eqStore(page);
    console.log(`[EQ] store after power: enabled=${store?.enabled}`);
    expect(store?.enabled).toBe(true);

    // preset 'Rock' applies gains
    await page.getByRole('button', { name: 'Rock' }).click();
    store = await eqStore(page);
    console.log(`[EQ] Rock preset gains: [${(store?.gains || []).slice(0, 4)}]`);
    expect(store?.preset).toBe('Rock');
    expect((store?.gains || []).some((g: number) => g !== 0)).toBe(true);

    // bass boost slider (index 10 = after 10 band sliders)
    const bassSlider = panel.locator('input[type="range"]').nth(10);
    await bassSlider.fill('8', { timeout: 5000 });
    await page.waitForTimeout(300);
    store = await eqStore(page);
    console.log(`[EQ] bassBoost=${store?.bassBoost}`);
    expect(store?.bassBoost).toBe(8);

    // stereo width slider (index 12)
    const stereoSlider = panel.locator('input[type="range"]').nth(12);
    await stereoSlider.fill('0.9', { timeout: 5000 });
    store = await eqStore(page);
    console.log(`[EQ] stereoWidth=${store?.stereoWidth}`);
    expect(store?.stereoWidth).toBeCloseTo(0.9, 1);

    // effect toggles — verify a real state flip (presets may pre-enable effects)
    for (const label of ['Loudness', 'Limiter', 'Virtualizer']) {
      const btn = page.getByRole('button', { name: new RegExp(label) });
      const key = label === 'Loudness' ? 'loudnessMode' : label === 'Limiter' ? 'limiterEnabled' : 'virtualizerEnabled';
      const before = (await eqStore(page))?.[key];
      await btn.click();
      await page.waitForTimeout(500);
      const after = (await eqStore(page))?.[key];
      console.log(`[EQ] ${label}: ${before} → ${after}`);
      expect(after).toBe(!before);
    }
    await closePanel(page, 'Equalizer');
  });

  // ── 6. KEYBOARD SHORTCUTS ──────────────────────────────────────────────────
await test.step('13. keyboard shortcuts (L=favorite, space, shift+arrows/N/P)', async () => {
    // L toggles the favorite (per useKeyboardShortcuts)
    const heartBtn = player(page).locator('button:has(svg.lucide-heart)');
    await expect(heartBtn).toBeVisible();
    const fillBefore = await heartBtn.locator('svg').getAttribute('fill');
    await page.locator('body').press('l');
    await page.waitForTimeout(500);
    const fillAfter = await heartBtn.locator('svg').getAttribute('fill');
    console.log(`[Keys] L: heart ${fillBefore} → ${fillAfter}`);
    expect(fillAfter).not.toBe(fillBefore);

    // Shift+N → next track; Shift+P → previous track
    const beforeTrack = await player(page).locator('p').first().textContent();
    await page.keyboard.press('Shift+N');
    let afterTrack = beforeTrack;
    for (let i = 0; i < 15 && afterTrack === beforeTrack; i++) {
      await page.waitForTimeout(700);
      afterTrack = await player(page).locator('p').first().textContent();
    }
    console.log(`[Keys] Shift+N: "${beforeTrack?.trim()}" → "${afterTrack?.trim()}"`);
    expect(afterTrack).not.toBe(beforeTrack);
    await page.keyboard.press('Shift+P');
    await page.waitForTimeout(3000);

    // Space toggles play/pause — normalize to a paused state first
    const p = player(page);
    for (let i = 0; i < 4; i++) {
      if ((await p.locator('svg.lucide-pause').count()) > 0) {
        await p.locator('button:has(svg.lucide-pause)').click();
        await waitForPlayerIcon(page, 'play', 30000);
        break;
      }
      if ((await p.locator('svg.lucide-play').count()) > 0) break;
      await page.waitForTimeout(800);
    }
    await page.locator('body').press('Space');
    await waitForPlayerIcon(page, 'pause');
    console.log('[Keys] space toggles play → playing');
    await page.locator('body').press('Space');
    await waitForPlayerIcon(page, 'play');
    console.log('[Keys] space toggles pause → OK');

    const before = await player(page).locator('.font-mono').first().textContent();
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(800);
    const after = await player(page).locator('.font-mono').first().textContent();
    console.log(`[Keys] shift+→ seek: ${before} → ${after}`);
    expect(after).not.toBe(before);
    await page.keyboard.press('Shift+ArrowLeft');
    await page.waitForTimeout(800);
    const afterBack = await player(page).locator('.font-mono').first().textContent();
    console.log(`[Keys] shift+← seek: ${after} → ${afterBack}`);
    expect(afterBack).not.toBe(after);
  });

  // ── 7. PAGES ───────────────────────────────────────────────────────────────
  await test.step('14. search page', async () => {
    await page.goto(`${BASE}/search`);
    const input = page.locator('input[placeholder*="Search"]');
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.fill('Arijit');
    await page.waitForTimeout(2000);
    console.log(`[Search] placeholder='${await input.getAttribute('placeholder')}' → typed query`);
    await expect(page.getByRole('button', { name: /Filters/ })).toBeVisible();
    await page.getByRole('button', { name: /Filters/ }).click();
    await page.waitForTimeout(500);
    console.log('[Search] Filters popover opened');
  });

  await test.step('15. library page', async () => {
    await page.goto(`${BASE}/library`);
    await expect(page.getByRole('heading', { name: /Your Library|Library/i }).first()).toBeVisible();
    for (const tab of ['Songs', 'Albums', 'Playlists']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${tab}$`) })).toBeVisible();
    }
    await page.getByRole('button', { name: /^Playlists$/ }).click();
    await page.waitForTimeout(500);
    console.log('[Library] tabs present and clickable');
  });

  await test.step('16. discover page', async () => {
    await page.goto(`${BASE}/discover`);
    await expect(page.getByRole('heading', { name: /Discover/i })).toBeVisible();
    await expect(page.locator('button, a').filter({ hasText: /Genre|All|Pop|Rock|Indian/i }).first()).toBeVisible();
    console.log('[Discover] genre chips OK');
  });

  await test.step('17. favorites page', async () => {
    // (Re-)favorite the current track so the page has content — step 13's
    // keyboard test toggled it off with the L shortcut.
    const heartBtn = player(page).locator('button:has(svg.lucide-heart)');
    if ((await heartBtn.locator('svg').getAttribute('fill')) !== 'currentColor') {
      await heartBtn.click();
      await page.waitForTimeout(400);
    }
    await page.goto(`${BASE}/favorites`);
    // Catalog fetch is async — wait for either the empty state or a row
    const empty = page.getByText('No favorites yet');
    await expect(empty.or(songRow(page).first())).toBeVisible({ timeout: 20000 });
    const rows = await songRow(page).count();
    console.log(`[Favorites] favorite rows: ${rows}`);
    if (rows === 0) {
      const heading = await page.getByRole('heading', { name: /Favorites/i }).textContent();
      console.log(`[Favorites] heading: ${heading}`);
    }
    expect(rows, 'favorited track should appear on the favorites page').toBeGreaterThan(0);
  });

  await test.step('18. history page', async () => {
    await page.goto(`${BASE}/history`);
    await expect(page.getByRole('heading', { name: /History/i }).first()).toBeVisible();
    const clearBtn = page.getByRole('button', { name: /Clear all/i });
    if (await clearBtn.count()) {
      await clearBtn.click();
      console.log('[History] cleared');
    } else {
      console.log('[History] no clear-all button found — possible BUG(???)');
    }
  });

  await test.step('19. downloads page', async () => {
    await page.goto(`${BASE}/downloads`);
    await expect(page.getByRole('heading', { name: /Download/i }).first()).toBeVisible();
    console.log('[Downloads] page renders');
  });

  await test.step('20. charts page', async () => {
    await page.goto(`${BASE}/charts`);
    await expect(page.getByRole('heading', { name: /Charts/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Refresh/i })).toBeVisible();
    console.log('[Charts] refresh button visible');
  });

  await test.step('21. settings page', async () => {
    await page.goto(`${BASE}/settings`);
    await expect(page.getByRole('heading', { name: /Settings/i })).toBeVisible();
    const autoplay = page.getByRole('button', { name: /Enable autoplay|Disable autoplay/i });
    if (await autoplay.count()) {
      await autoplay.click();
      const newLabel = await autoplay.textContent();
      console.log(`[Settings] autoplay toggled → "${newLabel?.trim()}"`);
    } else {
      console.log('[Settings] autoplay toggle missing — possible BUG');
    }
    // theme picker
    await expect(page.getByText('Theme', { exact: true }).first()).toBeVisible();
  });

  await test.step('22. create playlist form', async () => {
    await page.goto(`${BASE}/create-playlist`);
    await expect(page.getByRole('heading', { name: /Playlist/i })).toBeVisible();
    await page.fill('input[placeholder="My Playlist"], input[placeholder*="name"]', 'E2E Test Playlist');
    await page.fill('textarea[placeholder*="description"], input[placeholder*="description"]', 'created by e2e');
    console.log('[CreatePlaylist] form filled');
    const submit = page.getByRole('button', { name: /Create|Save|Done/i }).first();
    await expect(submit).toBeVisible();
  });

  await test.step('23. create album form', async () => {
    await page.goto(`${BASE}/create-album`);
    await expect(page.getByRole('heading', { name: /Album/i })).toBeVisible();
    await page.fill('input[placeholder="Album Title"]', 'E2E Album');
    await page.fill('input[placeholder="Artist Name"]', 'E2E Artist');
    console.log('[CreateAlbum] form filled');
  });

  await test.step('24. 404 page', async () => {
    await page.goto(`${BASE}/totally-not-a-real-route`);
    await expect(page.getByText('404', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Page not found/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
    console.log('[404] page renders with Home button');
  });

  await test.step('25. error collection', async () => {
    const realConsole = consoleErrors.filter((e) => !/DevTools|favicon|\[HMR\]/.test(e));
    console.log(`[Errors] pageErrors=${pageErrors.length} consoleErrors=${realConsole.length} failedRequests=${failedRequests.length}`);
    for (const e of realConsole) console.log(`[Errors] console: ${e}`);
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});

test('mobile viewport: player expand + panels', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await stubAuth(page);
  await page.goto(BASE);
  await expect(songRow(page).first()).toBeVisible({ timeout: 30000 });

  const expand = page.locator('[aria-label="Expand player"]');
  await expect(expand).toBeVisible();
  await expand.click();
  await expect(page.getByText('Now Playing')).toBeVisible();
  console.log('[Mobile] expanded player OK');

  for (const label of ['Lyrics', 'Equalizer', 'Queue']) {
    const b = page.getByRole('button', { name: new RegExp(label) });
    await expect(b.first()).toBeVisible();
    console.log(`[Mobile] expanded player has ${label} button`);
  }
});

/** Seed localStorage so a test doesn't need the login form. */
async function stubAuth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('musicAppUser', JSON.stringify({
      id: 'e2e', name: 'E2E', email: 'e2e-user@example.com', avatar: '',
    }));
  });
}

/** Read the persisted audio-effects store. */
async function eqStore(page: Page): Promise<any> {
  return page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('audio_effects_v1') || 'null'); }
    catch { return null; }
  });
}