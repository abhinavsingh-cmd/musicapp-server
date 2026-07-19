import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const routes = [
  { name: 'Home',      path: '/' },
  { name: 'Login',     path: '/login' },
  { name: 'Search',    path: '/search' },
  { name: 'Library',   path: '/library' },
  { name: 'Discover',  path: '/discover' },
  { name: 'Favorites', path: '/favorites' },
  { name: 'Charts',    path: '/charts' },
  { name: 'History',   path: '/history' },
  { name: 'Downloads', path: '/downloads' },
  { name: 'Settings',  path: '/settings' },
  { name: 'CreatePlaylist', path: '/create-playlist' },
  { name: 'CreateAlbum',    path: '/create-album' },
];

const issues = [];
let browser, context, page;

function record(level, route, type, message) {
  issues.push({ level, route, type, message });
}

async function setup() {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();

  await page.addInitScript(() => {
    localStorage.setItem('auth-user', JSON.stringify({
      id: '1', name: 'Test', email: 'test@test.com', avatar: '', token: 'fake-jwt-token'
    }));
  });
}

async function dismissViteOverlay() {
  const overlay = await page.$('vite-error-overlay');
  if (overlay) {
    // Get the error message from the shadow DOM
    const errorMsg = await page.evaluate(() => {
      const overlay = document.querySelector('vite-error-overlay');
      if (!overlay?.shadowRoot) return null;
      const msg = overlay.shadowRoot.querySelector('.message-body');
      return msg?.textContent || overlay.shadowRoot.querySelector('.error')?.textContent || 'unknown error';
    });
    if (errorMsg) {
      record('CRITICAL', 'ViteOverlay', 'RUNTIME_ERROR', errorMsg.slice(0, 500));
      console.log(`  VITE ERROR OVERLAY: ${errorMsg.slice(0, 300)}`);
    }
    // Remove it
    await page.evaluate(() => {
      const overlay = document.querySelector('vite-error-overlay');
      if (overlay) overlay.remove();
    });
  }
}

async function testRoute(route) {
  const consoleErrors = [];
  const networkErrors = [];
  const pageErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('response', resp => {
    if (resp.status() >= 400 && !resp.url().includes('favicon')) {
      networkErrors.push(`${resp.status()} ${resp.url()}`);
    }
  });
  page.on('requestfailed', req => {
    networkErrors.push(`FAIL ${req.url()} ${req.failure()?.errorText || 'unknown'}`);
  });

  try {
    await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle', timeout: 15000 });
    await dismissViteOverlay();

    const hasRoot = await page.evaluate(() => {
      const root = document.getElementById('root');
      return root ? root.children.length > 0 : false;
    });

    if (!hasRoot) {
      record('CRITICAL', route.name, 'BLACK_SCREEN', 'Root element has no children');
    }

    for (const err of consoleErrors) {
      if (err.includes('Download the React DevTools') || err.includes('favicon') || err.includes('[HMR]')) continue;
      record('HIGH', route.name, 'CONSOLE_ERROR', err.slice(0, 500));
    }

    for (const err of pageErrors) {
      record('CRITICAL', route.name, 'PAGE_ERROR', err.slice(0, 500));
    }

    for (const err of networkErrors) {
      if (err.includes('youtube') || err.includes('stream') || err.includes('download') || err.includes('favicon')) continue;
      record('HIGH', route.name, 'NETWORK_ERROR', err.slice(0, 300));
    }

    console.log(`  [${route.name}] OK — console: ${consoleErrors.length}, page: ${pageErrors.length}, network: ${networkErrors.length}`);
  } catch (err) {
    record('CRITICAL', route.name, 'NAVIGATION_ERROR', err.message?.slice(0, 500));
    console.log(`  [${route.name}] FAILED: ${err.message?.slice(0, 200)}`);
  }

  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.removeAllListeners('response');
  page.removeAllListeners('requestfailed');
}

async function testSearch() {
  console.log('\n--- Testing Search ---');
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto(`${BASE}/search`, { waitUntil: 'networkidle', timeout: 15000 });
  await dismissViteOverlay();

  const searchInput = await page.$('input[type="text"], input[placeholder*="earch"]');
  if (!searchInput) {
    record('CRITICAL', 'Search', 'MISSING_INPUT', 'No search input found');
    console.log('  [Search] CRITICAL: No search input found');
  } else {
    await searchInput.fill('Arijit');
    await page.waitForTimeout(1000);
    console.log('  [Search] Input found and typed');
  }

  for (const err of pageErrors) {
    record('CRITICAL', 'Search', 'PAGE_ERROR', err.slice(0, 500));
  }
  page.removeAllListeners('pageerror');
}

async function testPlayback() {
  console.log('\n--- Testing Playback ---');
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 15000 });
  await dismissViteOverlay();

  // Find and click a song row
  const songRow = await page.$('.song-row');
  if (songRow) {
    await songRow.click();
    await page.waitForTimeout(2000);
    console.log('  [Playback] Clicked song row');
  } else {
    record('HIGH', 'Playback', 'NO_SONGS', 'No song rows on home page');
    console.log('  [Playback] No song rows found');
  }

  for (const err of pageErrors) {
    record('CRITICAL', 'Playback', 'PAGE_ERROR', err.slice(0, 500));
  }
  page.removeAllListeners('pageerror');
}

async function run() {
  console.log('=== E2E SMOKE TEST v2 ===\n');
  await setup();

  console.log('--- Route Navigation ---');
  for (const route of routes) {
    await testRoute(route);
  }

  await testSearch();
  await testPlayback();

  await browser.close();

  console.log('\n=== ISSUES FOUND ===');
  if (issues.length === 0) {
    console.log('No issues found!');
  } else {
    for (const issue of issues) {
      console.log(`\n[${issue.level}] ${issue.route} — ${issue.type}`);
      console.log(`  ${issue.message}`);
    }
  }

  const fs = await import('fs');
  fs.writeFileSync('/tmp/smoke-issues.json', JSON.stringify(issues, null, 2));
  console.log(`\nTotal issues: ${issues.length}`);
}

run().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
