/**
 * COMPREHENSIVE RUNTIME DIAGNOSTIC
 * 
 * Instruments every critical path. Captures:
 *   - timestamp
 *   - file:line
 *   - function
 *   - parameters
 *   - response
 *   - stack trace
 * 
 * Then reproduces: black screen, search, trending, playback, playlist crash.
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'http://localhost:3000';
const LOG_FILE = '/tmp/runtime-diagnostic.log';

let logs = [];
function log(level, category, msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 23);
  const line = `[${ts}] [${level}] [${category}] ${msg}`;
  logs.push(line);
  console.log(line);
}

// ─── Instrumentation injection script ───────────────────────────────────────
const INSTRUMENT_JS = `
(function() {
  const _logs = window.__DIAG_LOGS = [];
  const _ts = () => new Date().toISOString().replace('T',' ').slice(0,23);
  
  function diag(level, cat, fn, params, result, stack) {
    const entry = { ts: _ts(), level, cat, fn, params, result, stack };
    _logs.push(entry);
  }

  // ─── 1. Intercept all fetch() calls ────────────────────────────────────
  const _origFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || 'unknown';
    const method = args[1]?.method || 'GET';
    diag('INFO', 'fetch', 'fetch.start', method + ' ' + url.slice(0, 120), null, null);
    const start = Date.now();
    try {
      const res = await _origFetch.apply(this, args);
      const elapsed = Date.now() - start;
      diag(res.ok ? 'INFO' : 'ERROR', 'fetch', 'fetch.response', 
        res.status + ' ' + url.slice(0, 120),
        elapsed + 'ms', null);
      return res;
    } catch(err) {
      const elapsed = Date.now() - start;
      diag('ERROR', 'fetch', 'fetch.error', 
        url.slice(0, 120) + ' | ' + (err?.message || err),
        elapsed + 'ms', err?.stack?.slice(0, 300));
      throw err;
    }
  };

  // ─── 2. Intercept HTMLAudioElement ─────────────────────────────────────
  const _origAudio = window.Audio;
  window.Audio = function(src) {
    const audio = new _origAudio(src);
    const id = 'audio-' + Math.random().toString(36).slice(2, 8);
    audio.__diagId = id;
    
    diag('INFO', 'HTMLAudio', 'Audio.constructor', src || '(no src)', id, null);
    
    const origPlay = audio.play.bind(audio);
    audio.play = function() {
      diag('INFO', 'HTMLAudio', 'play', audio.src?.slice(0, 100) || '(no src)', null, null);
      return origPlay().then(() => {
        diag('INFO', 'HTMLAudio', 'play.success', audio.src?.slice(0, 100) || '', null, null);
      }).catch(err => {
        diag('ERROR', 'HTMLAudio', 'play.rejected', 
          audio.src?.slice(0, 100) + ' | ' + (err?.message || err),
          null, err?.stack?.slice(0, 300));
        throw err;
      });
    };
    
    audio.addEventListener('error', (e) => {
      const error = audio.error;
      diag('ERROR', 'HTMLAudio', 'error.event',
        'code=' + (error?.code || '?') + ' msg=' + (error?.message || '?') + ' src=' + (audio.src?.slice(0, 80) || ''),
        null, null);
    });
    
    audio.addEventListener('ended', () => {
      diag('INFO', 'HTMLAudio', 'ended', audio.src?.slice(0, 80) || '', null, null);
    });
    
    audio.addEventListener('loadedmetadata', () => {
      diag('INFO', 'HTMLAudio', 'loadedmetadata', 
        'dur=' + audio.duration + ' src=' + (audio.src?.slice(0, 80) || ''), null, null);
    });
    
    audio.addEventListener('canplay', () => {
      diag('INFO', 'HTMLAudio', 'canplay', audio.src?.slice(0, 80) || '', null, null);
    });
    
    return audio;
  };
  window.Audio.prototype = _origAudio.prototype;

  // ─── 3. Intercept React Router navigation ──────────────────────────────
  const _origPushState = history.pushState.bind(history);
  history.pushState = function(...args) {
    diag('NAV', 'Router', 'pushState', args[2] || '', null, null);
    return _origPushState(...args);
  };
  window.addEventListener('popstate', () => {
    diag('NAV', 'Router', 'popstate', location.pathname, null, null);
  });

  // ─── 4. Intercept XMLHttpRequest (some older code paths) ───────────────
  const _origXHROpen = XMLHttpRequest.prototype.open;
  const _origXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__diagMethod = method;
    this.__diagUrl = url;
    return _origXHROpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const url = this.__diagUrl || '';
    diag('INFO', 'XHR', 'send', this.__diagMethod + ' ' + (url?.slice(0, 100) || ''), null, null);
    this.addEventListener('load', () => {
      diag(this.status < 400 ? 'INFO' : 'ERROR', 'XHR', 'response', 
        this.status + ' ' + (url?.slice(0, 100) || ''), null, null);
    });
    this.addEventListener('error', () => {
      diag('ERROR', 'XHR', 'error', (url?.slice(0, 100) || ''), null, null);
    });
    return _origXHRSend.call(this, body);
  };

  // ─── 5. Capture ALL console output ─────────────────────────────────────
  const _origConsole = {};
  for (const level of ['log', 'warn', 'error', 'info']) {
    _origConsole[level] = console[level].bind(console);
    console[level] = function(...args) {
      _origConsole[level](...args);
      const msg = args.map(a => {
        if (a === null || a === undefined) return String(a);
        if (typeof a === 'object') {
          try { return JSON.stringify(a).slice(0, 500); } catch { return String(a).slice(0, 500); }
        }
        return String(a).slice(0, 500);
      }).join(' ');
      
      // Classify by tag
      const tag = msg.match(/^\[([^\]]+)\]/)?.[1] || '';
      const tags = {
        'AudioStore': 'audioStore', 'AudioService': 'audioService',
        'YouTubePlayer': 'youtubePlayer', 'ChartsStore': 'chartsStore',
        'SearchStore': 'searchStore', 'QueueStore': 'queueStore',
        'MediaSession': 'mediaSession', 'Background': 'background',
        'Recommendation': 'recommendation', 'ErrorBoundary': 'errorBoundary',
        'API': 'api', 'Stream': 'stream', 'Download': 'download',
        'Trending': 'trending', 'YT Search': 'ytSearch',
      };
      const cat = tags[tag] || 'console';
      
      diag(level.toUpperCase() === 'ERROR' ? 'ERROR' : 'LOG', cat, 'console.' + level, msg.slice(0, 600), null, null);
    };
  }

  // ─── 6. Capture uncaught errors & promise rejections ───────────────────
  window.addEventListener('error', (event) => {
    diag('CRITICAL', 'global', 'uncaughtError', 
      (event.filename || '') + ':' + (event.lineno || '?') + ':' + (event.colno || '?'),
      event.message?.slice(0, 500) || 'unknown',
      event.error?.stack?.slice(0, 500) || null);
  });
  
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    diag('CRITICAL', 'global', 'unhandledRejection',
      (reason?.message || String(reason))?.slice(0, 500),
      null,
      reason?.stack?.slice(0, 500) || null);
  });

  // ─── 7. Capture React errors via ErrorBoundary ─────────────────────────
  window.__DIAG_REACT_ERRORS = [];
  const _origConsoleError = console.error;
  console.error = function(...args) {
    _origConsoleError.apply(console, args);
    const msg = args.map(a => typeof a === 'string' ? a : String(a).slice(0, 500)).join(' ');
    if (msg.includes('Maximum update depth') || msg.includes('getSnapshot') || 
        msg.includes('ErrorBoundary') || msg.includes('React') || msg.includes('render')) {
      window.__DIAG_REACT_ERRORS.push({ ts: _ts(), msg: msg.slice(0, 800) });
      diag('CRITICAL', 'react', 'reactError', msg.slice(0, 600), null, null);
    }
  };

  console.log('[DIAG] Instrumentation active');
})();
`;

// ─── Scenario runners ──────────────────────────────────────────────────────

async function captureLogs(page) {
  const raw = await page.evaluate(() => JSON.stringify(window.__DIAG_LOGS || []));
  const parsed = JSON.parse(raw);
  for (const entry of parsed) {
    const line = `[${entry.ts}] [${entry.level}] [${entry.cat}] ${entry.fn}: ${entry.params || ''}${entry.result ? ' => ' + entry.result : ''}`;
    logs.push(line);
  }
}

async function clearLogs(page) {
  await page.evaluate(() => { window.__DIAG_LOGS = []; });
}

async function reproduceBlackScreen(page) {
  log('====', 'SCENARIO', '═══ 1. BLACK SCREEN CHECK ═══');
  
  const routes = ['/', '/search', '/library', '/discover', '/charts', '/settings', '/favorites', '/history', '/downloads'];
  
  for (const route of routes) {
    await clearLogs(page);
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      
      // Check for vite error overlay
      const hasOverlay = await page.$('vite-error-overlay');
      if (hasOverlay) {
        const overlayMsg = await page.evaluate(() => {
          const o = document.querySelector('vite-error-overlay');
          return o?.shadowRoot?.querySelector('.message-body')?.textContent || 'overlay present';
        });
        log('CRITICAL', route, 'VITE_ERROR_OVERLAY', overlayMsg.slice(0, 500), null);
      }
      
      // Check root element
      const rootInfo = await page.evaluate(() => {
        const root = document.getElementById('root');
        if (!root) return { exists: false, children: 0, html: '' };
        return {
          exists: true,
          children: root.children.length,
          html: root.innerHTML.slice(0, 200),
          text: root.innerText?.slice(0, 200) || '',
        };
      });
      
      if (!rootInfo.exists || rootInfo.children === 0) {
        log('CRITICAL', route, 'BLACK_SCREEN', 'Root empty', rootInfo.html, null);
      } else {
        log('INFO', route, 'PAGE_RENDERED', `children=${rootInfo.children} text="${rootInfo.text.slice(0, 80)}"`, null);
      }
      
      await captureLogs(page);
    } catch (err) {
      log('CRITICAL', route, 'NAVIGATION_FAILED', err.message?.slice(0, 300), null);
    }
  }
}

async function reproduceSearch(page) {
  log('====', 'SCENARIO', '═══ 2. SEARCH ═══');
  
  await clearLogs(page);
  await page.goto(`${BASE}/search`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  
  // Dismiss overlay if present
  await page.evaluate(() => {
    const o = document.querySelector('vite-error-overlay');
    if (o) o.remove();
  });
  
  const input = await page.$('input[type="text"]');
  if (!input) {
    log('CRITICAL', 'search', 'NO_INPUT', 'Search input not found on page', null);
    await captureLogs(page);
    return;
  }
  
  log('INFO', 'search', 'INPUT_FOUND', 'search input located', null);
  
  // Type and observe
  await input.fill('Arijit Singh');
  log('INFO', 'search', 'QUERY_TYPED', 'Arijit Singh', null);
  await page.waitForTimeout(2000);
  
  // Check results
  const searchState = await page.evaluate(() => {
    // Try to access Zustand store
    const root = document.getElementById('root');
    const text = root?.innerText || '';
    return {
      hasResults: text.includes('Arijit') || text.includes('result'),
      textSnippet: text.slice(0, 300),
      hasLoading: text.includes('Loading') || text.includes('Searching'),
      hasError: text.includes('error') || text.includes('Error'),
    };
  });
  
  log(searchState.hasResults ? 'INFO' : 'WARN', 'search', 'SEARCH_RESULT', 
    JSON.stringify(searchState), null);
  
  await captureLogs(page);
}

async function reproduceTrending(page) {
  log('====', 'SCENARIO', '═══ 3. TRENDING / CHARTS ═══');
  
  await clearLogs(page);
  await page.goto(`${BASE}/charts`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  
  await page.evaluate(() => {
    const o = document.querySelector('vite-error-overlay');
    if (o) o.remove();
  });
  
  await page.waitForTimeout(3000); // Wait for trending fetch
  
  const chartsState = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    return {
      hasCharts: text.includes('Chart') || text.includes('Trending') || text.includes('Top'),
      hasLoading: text.includes('Loading'),
      hasError: text.includes('error') || text.includes('Error'),
      textSnippet: text.slice(0, 400),
    };
  });
  
  log(chartsState.hasCharts ? 'INFO' : 'WARN', 'charts', 'CHARTS_STATE', JSON.stringify(chartsState), null);
  
  await captureLogs(page);
}

async function reproducePlayback(page) {
  log('====', 'SCENARIO', '═══ 4. PLAYBACK ═══');
  
  await clearLogs(page);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  
  await page.evaluate(() => {
    const o = document.querySelector('vite-error-overlay');
    if (o) o.remove();
  });
  
  await page.waitForTimeout(1000);
  
  // Find a song row
  const songRow = await page.$('.song-row');
  if (!songRow) {
    log('CRITICAL', 'playback', 'NO_SONG_ROWS', 'No song rows found on home page', null);
    await captureLogs(page);
    return;
  }
  
  log('INFO', 'playback', 'SONG_ROW_FOUND', 'Clicking first song', null);
  
  try {
    await songRow.click();
    log('INFO', 'playback', 'CLICK_SENT', 'Click dispatched', null);
  } catch (err) {
    log('CRITICAL', 'playback', 'CLICK_FAILED', err.message?.slice(0, 200), null);
    await captureLogs(page);
    return;
  }
  
  await page.waitForTimeout(5000); // Wait for audio to attempt load
  
  // Check audio state
  const audioState = await page.evaluate(() => {
    const audio = document.querySelector('audio');
    // Check for YouTube player iframe
    const ytIframe = document.querySelector('iframe[src*="youtube"]');
    const ytDiv = document.getElementById('youtube-player-container');
    return {
      audioInDOM: !!audio,
      audioSrc: audio?.src?.slice(0, 100) || 'none',
      audioPaused: audio?.paused ?? true,
      audioError: audio?.error ? { code: audio.error.code, message: audio.error.message } : null,
      ytIframe: !!ytIframe,
      ytDiv: !!ytDiv,
      documentTitle: document.title,
    };
  });
  
  log(audioState.audioError ? 'ERROR' : 'INFO', 'playback', 'AUDIO_STATE', JSON.stringify(audioState), null);
  
  // Check for player UI
  const playerUI = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    return {
      hasPlayerBar: text.includes('0:') || text.includes('1:') || text.includes('2:') || text.includes('3:'),
      hasSongTitle: !!document.querySelector('[class*="song-title"], [class*="SongTitle"], [class*="now-playing"]'),
    };
  });
  log('INFO', 'playback', 'PLAYER_UI', JSON.stringify(playerUI), null);
  
  await captureLogs(page);
}

async function reproducePlaylist(page) {
  log('====', 'SCENARIO', '═══ 5. PLAYLIST CRASH ═══');
  
  await clearLogs(page);
  
  // Go to library first
  await page.goto(`${BASE}/library`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.evaluate(() => {
    const o = document.querySelector('vite-error-overlay');
    if (o) o.remove();
  });
  
  await page.waitForTimeout(1000);
  
  // Check for playlists
  const libState = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    return {
      hasPlaylist: text.includes('Playlist') || text.includes('playlist'),
      textSnippet: text.slice(0, 300),
    };
  });
  log('INFO', 'library', 'LIBRARY_STATE', JSON.stringify(libState), null);
  
  // Click on first playlist card if present
  const playlistCard = await page.$('[class*="playlist"], [class*="Playlist"]');
  if (playlistCard) {
    try {
      await playlistCard.click();
      await page.waitForTimeout(2000);
      log('INFO', 'playlist', 'PLAYLIST_CLICKED', 'Opened playlist', null);
    } catch (err) {
      log('CRITICAL', 'playlist', 'PLAYLIST_CLICK_FAILED', err.message?.slice(0, 200), null);
    }
  } else {
    // Try creating a playlist
    await page.goto(`${BASE}/create-playlist`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.evaluate(() => {
      const o = document.querySelector('vite-error-overlay');
      if (o) o.remove();
    });
    log('INFO', 'playlist', 'CREATE_PLAYLIST_PAGE', 'Navigated to create-playlist', null);
  }
  
  await captureLogs(page);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function run() {
  log('====', 'DIAG', '═══ RUNTIME DIAGNOSTIC START ═══');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  
  // Set auth to bypass login
  await page.addInitScript(() => {
    localStorage.setItem('auth-user', JSON.stringify({
      id: '1', name: 'Test', email: 'test@test.com', avatar: '', token: 'fake-jwt-token'
    }));
  });
  
  // Inject instrumentation BEFORE page load
  await page.addInitScript(INSTRUMENT_JS);
  
  // First, just load the app
  log('====', 'DIAG', 'Loading app...');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(5000);
  
  // Check instrumentation is active
  const diagActive = await page.evaluate(() => !!(window.__DIAG_LOGS && window.__DIAG_REACT_ERRORS));
  log('INFO', 'DIAG', 'INSTRUMENTATION', diagActive ? 'ACTIVE' : 'FAILED', null);
  
  // Run all scenarios
  await reproduceBlackScreen(page);
  await reproduceSearch(page);
  await reproduceTrending(page);
  await reproducePlayback(page);
  await reproducePlaylist(page);
  
  // Final summary
  const finalErrors = await page.evaluate(() => window.__DIAG_REACT_ERRORS || []);
  log('====', 'DIAG', `React errors captured: ${finalErrors.length}`);
  for (const err of finalErrors) {
    log('CRITICAL', 'react', 'STORED_ERROR', err.msg.slice(0, 500), null);
  }
  
  await browser.close();
  
  // Write full log
  writeFileSync(LOG_FILE, logs.join('\n'));
  log('====', 'DIAG', `Full diagnostic written to ${LOG_FILE}`);
  log('====', 'DIAG', `Total log lines: ${logs.length}`);
  log('====', 'DIAG', '═══ RUNTIME DIAGNOSTIC END ═══');
}

run().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
