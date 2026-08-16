import { test, expect, type Page } from '@playwright/test';
import { BASE, player, songRow, login, waitForAnyPlayerIcon } from './helpers';

/**
 * Mobile layout probe — measures the actual geometry of the fixed bottom
 * player, the mobile bottom nav, the content scroll area, and the player
 * panels on a narrow Android-class viewport. The dynamic --player-h CSS
 * variable is driven by a ResizeObserver on the bar; these tests assert the
 * RENDERED result: no overlap between bar/nav, no rows hidden behind the
 * fixed chrome, and no layout explosion when the player is expanded.
 */
test.use({ viewport: { width: 390, height: 844 } });

const nav = (page: Page) => page.locator('.mobile-nav');
const bar = (page: Page) => player(page);
const expandBtn = (page: Page) => page.locator('button[aria-label="Expand player"]');

async function boxes(page: Page) {
  const b = await bar(page).boundingBox();
  const n = await nav(page).boundingBox();
  return { bar: b, nav: n, vh: page.viewportSize()?.height ?? 0 };
}

test.describe('mobile player layout (390×844)', () => {
  test('collapsed layout: bar sits at the bottom, nav sits directly above it, no overlap', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/library`);
    await expect(songRow(page).first()).toBeVisible({ timeout: 30_000 });

    // Give the ResizeObserver a beat to publish --player-h.
    await page.waitForTimeout(400);

    const { bar: b, nav: n, vh } = await boxes(page);
    expect(b, 'player bar must be visible').not.toBeNull();
    expect(n, 'mobile nav must be visible').not.toBeNull();
    expect(b!.y + b!.height).toBeGreaterThan(vh - 2); // bar bottom at viewport bottom
    // Nav bottom should sit at (or 1px above) the bar top — never overlapping it.
    expect(n!.y + n!.height).toBeGreaterThanOrEqual(b!.y - 2);
    expect(n!.y + n!.height).toBeLessThanOrEqual(b!.y + 2);
    // The nav must stay anchored in the bottom half (never pushed up by a
    // ballooned --player-h) and the bar must stay compact.
    expect(n!.y).toBeGreaterThan(vh / 2);
    expect(b!.height, 'collapsed bar stays compact').toBeLessThan(200);
    console.log(`[layout] bar=${JSON.stringify(b)} nav=${JSON.stringify(n)} vh=${vh}`);
  });

  test('last library row is fully reachable above the fixed chrome (no hidden rows)', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/library`);
    await expect(songRow(page).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(400);

    const { nav: n } = await boxes(page);
    // Scroll the content container to its very bottom.
    await page.evaluate(() => {
      const scrollers = Array.from(document.querySelectorAll('main, .overflow-y-auto'));
      const main = scrollers.find((el) => el.scrollHeight > el.clientHeight) || scrollers[scrollers.length - 1];
      (main as HTMLElement).scrollTop = (main as HTMLElement).scrollHeight;
    });
    await page.waitForTimeout(300);

    // The last rendered row must be fully above the nav's top edge.
    const rows = songRow(page);
    const count = await rows.count();
    let lastVisibleAbove: boolean | null = null;
    for (let i = count - 1; i >= 0; i--) {
      const box = await rows.nth(i).boundingBox();
      if (!box) continue;
      if (box.y < (n?.y ?? 0) && box.y + box.height <= (n?.y ?? 0) + 1) {
        lastVisibleAbove = true;
        break;
      }
    }
    expect(lastVisibleAbove, 'at least one row must be fully visible above the nav').toBe(true);
    console.log(`[layout] rows rendered=${count} nav.top=${n?.y}`);
  });

  test('download buttons on rows stay visible and tappable', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/library`);
    await expect(songRow(page).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(400);

    const { nav: n } = await boxes(page);
    const btns = page.locator('.song-row button[data-state]');
    const count = await btns.count();
    expect(count).toBeGreaterThan(0);
    // At least one download button is above the nav and has a real hit area.
    let found = false;
    for (let i = 0; i < count; i++) {
      const box = await btns.nth(i).boundingBox();
      if (!box) continue;
      if (box.y + box.height <= (n?.y ?? 0) + 1 && box.width >= 24 && box.height >= 24) {
        found = true;
        break;
      }
    }
    expect(found, 'a tappable download button must be visible above the nav').toBe(true);
  });

  test('expanded player: the bar must NOT balloon the measured height or push the nav off-screen', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/library`);
    await expect(songRow(page).first()).toBeVisible({ timeout: 30_000 });

    // Load a song so the expand affordance exists.
    await songRow(page).first().click();
    await waitForAnyPlayerIcon(page, 60_000);
    await page.waitForTimeout(400);

    await expect(expandBtn(page)).toBeVisible();
    await expandBtn(page).click();
    await page.waitForTimeout(500); // let the ResizeObserver re-measure

    const { bar: b, nav: n, vh } = await boxes(page);
    console.log(`[expanded] bar=${JSON.stringify(b)} nav=${JSON.stringify(n)} vh=${vh}`);
    // THE regression: the expanded sheet must NOT grow the measured bar —
    // the bar stays compact and the nav stays anchored above it. (Before the
    // fix: bar ballooned to ~409px and the nav floated at 44% viewport
    // height, covering page content.)
    expect(b!.height, 'expanded sheet must not inflate the bar height').toBeLessThan(200);
    expect(n!.y, 'nav must stay anchored in the bottom third when expanded').toBeGreaterThan(vh * 0.6);
    expect(n!.y + n!.height, 'nav must sit directly above the bar even when expanded')
      .toBeGreaterThanOrEqual(b!.y - 2);
    expect(n!.y + n!.height, 'nav must not overlap the bar')
      .toBeLessThanOrEqual(b!.y + 2);

    // Opening a panel while expanded replaces the expanded sheet (both are
    // bottom sheets) — the panel must open above the COLLAPSED bar.
    await page.locator('button[title="Queue"]').first().click();
    await page.waitForTimeout(300);
    const panel = page.locator('[role="dialog"][aria-label="Queue"]');
    await expect(panel).toBeVisible();
    const p = await panel.boundingBox();
    console.log(`[expanded] queue panel=${JSON.stringify(p)}`);
    expect(p, 'queue panel must be visible on screen while expanded').not.toBeNull();
    expect(p!.y + p!.height, 'panel must not overflow past the viewport').toBeLessThanOrEqual(vh + 2);
    expect(p!.y + p!.height, 'panel bottom must sit near the collapsed bar (not at the top of the screen)')
      .toBeGreaterThan(vh - 200);
  });
});
