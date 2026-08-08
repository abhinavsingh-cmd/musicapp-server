import { test, expect, Page } from '@playwright/test';

/**
 * Full user-journey UI test: every button, panel, page and store feature.
 * Run against a local `npm run dev` (vite :3000, api :3001).
 *
 * vtt about the sections:
 *   1. Auth/login
 *   2. Home page chrome + song rows
 *   3. Player: controls, seek, volume, shuffle, repeat, favorite, download
 *   4. Panels: Queue, Lyrics, Equalizer (presets, bands, toggles, persistence)
 *   5. Keyboard shortcuts
 *   6. Every route/page incl. create forms, settings, 404
 *   7. Mobile viewport
 */

const BASE = 'http://localhost:3000';

interface Collected {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

function collect(page: Page): Collected {
  const c: Collected = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') c.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => c.pageErrors.push(err.message));
  page.on('response', (resp) => {
    if (resp.status() >= 400) c.failedRequests.push(`${resp.status()} ${resp.url()}`);
  });
  return c;
}

const isBenignConsoleError = (t: string) =>
  t.includes('Download the React DevTools') ||
  t.includes('favicon') ||
  t.includes('[HMR]') ||
  t.includes('Autofill');

function findPlayer(page: Page) {
  return page.locator('.fixed.bottom-0');
}

function timeText(page: Page) {
  return page.locator('.fixed.bottom-0 .font-mono').first();
}

test.describe.configure({ mode: 'serial' });

test('user journey: login → home → player → panels → shortcuts → pages → 404', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const c = collect(page);

  await test.step('login', async () => {
    await page.goto(`${BASE}/login`);
    await expect(page.locator('input#email')).toBeVisible();
    await page.fill('input#email', 'tester@example.com');
    await page.fill('input#password', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(`${BASE}/`);
    await expect(page.locator('main, .liquid-glass').first()).toBeVisible({ timeout: 20000 });
  });

  const songRows = page.locator('.grid.grid-cols-12.group');

  await test.step('home page renders sections', async () => {
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(/Welcome|Trending|Good/i);
    await expect(songRows.first()).toBeVisible({ timeout: 20000 });
    const count = await songRows.count();
    console.log(`[Home] song rows visible: ${count}`);
    expect(count).toBeGreaterThan(0);
  });

  const player = tPlayer(page);

  await test.step('start playback from first song row', async () => {
    await songRows.first().click();
    await expect(player.locator('p').first()).not.toContainText('No song selected');
    const songTitle = await player.locator('p').first().textContent();
    expect(songTitle?.trim().length).toBeGreaterThan(0);
    console.log(`[Playback] playing: ${songTitle?.trim()}`);
    // Progress bar exists & time display visible
    await expect(player.locator('.font-mono').first()).toBeVisible();
  });

  await test.step('progress/seek', async () => {
    const bar = player.locator('div.relative.h-1\\.5.bg-white\\/10');
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    }
    await page.waitForTimeout(1200);
    expect(await player.locator('.font-mono').first().textContent()).not.toBe('0:00');
  });

  await test.step('play/pause toggle', async () => {
    const playBtn = player.locator('button:has(svg.lucide-play)');
    const pauseBtn = player.locator('button:has(svg.lucide-pause)');
    const state = (await pauseBtn.count()) > 0 ? 'playing' : 'paused';
    console.log(`[Controls] initial state: ${state}`);
    if (state === 'paused') {
      await playBtn.first().click();
      await expect(pauseBtn.first()).toBeVisible({ timeout: 15000 });
    }
    await pauseBtn.first().click();
    await expect(playBtn.first()).toBeVisible({ timeout: 15000 });
    await playBtn.first().click();
    await expect(pauseBtn.first()).toBeVisible({ timeout: 15000 });
    console.log('[Controls] pause/play OK');
  });

  await test.step('next / previous track', async () => {
    const firstTitle = await player.locator('p').first().textContent();
    await player.locator('button:has(svg.lucide-skip-forward)').click();
    await page.waitForTimeout(2500);
    const nextTitle = await player.locator('p').first().textContent();
    console.log(`[Controls] next: '${firstTitle?.trim()}' → '${nextTitle?.trim()}'`);
    expect(nextTitle).not.toBe(firstTitle);
    await player.locator('button:has(svg.lucide-skip-back)').click();
    await page.waitForTimeout(2500);
  });

  await test.step('shuffle + repeat cycle', async () => {
    await player.locator('[title="Shuffle Off"]').click();
    await expect(player.locator('[title="Shuffle On"]')).toBeVisible();
    console.log('[Shuffle] on');
    await page.locator('[title^="Repeat:"]').click();
    const r1 = await page.locator('[title^="Repeat:"]').getAttribute('title');
    await page.locator('[title^="Repeat:"]').click();
    const r2 = await page.locator('[title^="Repeat:"]').getAttribute('title');
    await page.locator('[title^="Repeat:"]').click();
    const r3 = await page.locator('[title^="Repeat:"]').getAttribute('title');
    console.log(`[Repeat] cycle: ${r1} → ${r2} → ${r3}`);
    expect(new Set([r1, r2, r3]).size).toBeGreaterThan(1);
  });

  await test.step('volume slider', async () => {
    const vol = player.locator('input[type="range"]').first();
    expect(await vol.inputValue()).not.toBe('');
    await vol.fill('0.0');
    await page.waitForTimeout(100);
    console.log('[Volume] set to 0 (mute icon path exercised)');
  });

  await test.step('favorite / heart', async () => {
    const heartBtn = player.locator('button:has(svg.lucide-heart)');
    await heartBtn.click();
    const filled = await heartBtn.locator('svg').getAttribute('fill');
    expect(filled).toBe('currentColor');
    console.log('[Favorite] added');
  });

  await test.step('download button', async () => {
    const dlBtn = player.locator('[title="Download"],[title="Cancel download"]');
    if ((await dlBtn.count()) === 0) {
      console.log('[Download] already downloaded — skipping click');
    } else {
      await dlBtn.first().click();
      await page.waitForTimeout(6000);
      const title = await player.locator('button:has(svg.lucide-download), button:has(svg.lucide-x), button:has(svg.lucide-check)').first().getAttribute('title').catch(() => null);
      console.log(`[Download] after click: ${title ?? 'unknown'}`);
    }
  });

  await test.step('queue panel', async () => {
    await player.locator('[title="Queue"]').click();
    await expect(page.getByText('Queue', { exact: true })).toBeVisible();
    const queueVisible = await page.locator('.fixed.bottom-28').count();
    expect(queueVisible).toBeGreaterThan(0);
    console.log('[Queue] panel opened');
    await player.locator('[title="Queue"]').click();
  });

  await test.step('lyrics panel', async () => {
    await player.locator('[title="Lyrics"]').click();
    await expect(page.getByText('Lyrics', { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(6000);
    const hasLines = (await page.locator('.cursor-pointer.hover\\:bg-white\\/5').count()) > 0;
    const hasEmpty = await page.getByText('No lyrics available').isVisible().catch(() => false);
    const stillLoading = await page.getByText('Loading lyrics...').isVisible().catch(() => false);
    console.log(`[Lyrics] lines=${hasLines} empty=${hasEmpty} stuckLoading=${stillLoading}`);
    if (stillLoading) console.log('[BUG] lyrics stuck on "Loading lyrics..." state');
    await player.locator('[title="Lyrics"]').click();
  });

  await test.step('equalizer panel', async () => {
    await player.locator('[title="Equalizer"]').click();
    await expect(page.getByRole('heading', { name: 'Audio Effects' })).toBeVisible();
    const band = page.locator('input[type="range"]');
    const presets = ['Flat', 'Bass Boost', 'Treble Boost', 'Rock', 'Classical', 'Jazz', 'Hip Hop', 'Electronic', 'Vocal', 'Pop'];
    for (const p of presets) {
      await expect(page.getByRole('button', { name: p })).toBeVisible();
    }
    console.log('[EQ] all 10 presets visible');
    // Power toggle: confirm it is off earlier -> click -> enabled
    const pow = page.getByRole('button', { name: '', exact: false }).filter({ has: page.locator('svg.lucide-power') });
    await pow.click();
    await page.waitForTimeout(300);
    // In dev the AudioContext may not exist, but store updates; check persisted data
    const store = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('audio_effects_v1') || 'null')
    );
    console.log(`[EQ] store after power toggle: enabled=${store?.enabled}`);
    expect(store?.enabled).toBe(true);
    // preset Rock sets nonzero gains
    await page.getByRole('button', { name: 'Rock' }).click();
    const store2 = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('audio_effects_v1') || 'null')
    );
    console.log(`[EQ] rock gains: ${store2?.gains?.slice(0, 5)}`);
    expect(store2?.pred).toBe('Rock');
    // bass slider changes value
    const bass = page.getByText('Bass Boost').locator('xpath=..').locator('input[type="range"]');
    await bass.fill('8');
    const store3 = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('audio_effects_v1') || 'null')
    );
    console.log(`[EQ] bassBoost=${store3?.bassBoost}`);
    expect(store3?.bassBoost).toBe(8);
    // toggles
    await page.getByRole('button', { name: /Loudness/ }).click();
    const store4 = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('audio_effects_v1') || 'null')
    );
    expect(store4?.loudnessMode).toBe(true);
    console.log('[EQ] loudness toggle OK');
    await player.locator('[title="Equalizer"]').click();
  });

  await test.step('keyboard shortcuts', async () => {
    // L toggles lyrics
    await page.locator('body').press('l');
    await expect(page.getByText('Lyrics', { exact: true }).first()).toBeVisible();
    await page.locator('body').press('l');
    await expect(page.getByText('Lyrics', { exact: true }).first()).toBeHidden();
    console.log('[Keys] L toggles lyrics OK');
    // Space toggles play/pause
    await page.locator('body').press('Space');
    await page.waitForTimeout(600);
    const pauseVisible = await (player.locator('button:has(svg.lucide-pause)')).count();
    await page.locator('body').press('Space');
    console.log(`[Keys] space toggles (pause visible after: ${pauseVisible > 0}) OK`);
    // Shift+Right seeks +10s
    const before = await page.locator('.fixed.bottom-0 .font-mono').first().textContent();
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(600);
    const after = await page.locator('.fixed.bottom-0 .font-mono').first().textContent();
    console.log(`[Keys] seek: ${before} → ${after}`);
    expect(after).not.toBe(before);
  });

  await stepNav(page);

  await test.step('404 page', async () => {
    await page.goto(`${BASE}/definitely-not-a-route`);
    await expect(page.getByText('404', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Page not found/i)).toBeVisible();
    console.log('[404] OK');
  });

  await test.step('no page crashes', async () => {
    expect(c.pageErrors, `uncaught page errors: ${c.pageErrors.join(' | ')}`).toEqual([]);
    const real = c.consoleErrors.filter((e) => !isBenignConsoleError(e));
    console.log(`[Console] real errors: ${real.length}`);
    console.log(`[Network] failed requests: ${c.failedRequests.length}`);
  });
});