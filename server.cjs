process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught exception:", err.message || err);
});

const express = require("express");
const cors = require("cors");
const compression = require("compression");
const { execFile, spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");
const app = express();

// ── YouTube bot-detection mitigation ─────────────────────────────────────
// YouTube blocks datacenter IPs (Render, AWS, …) with "Sign in to confirm
// you're not a bot". The default `web` player client is the most
// aggressively blocked; the mobile/Safari clients have a much higher success
// rate from datacenter IPs and newer yt-dlp versions rotate through them.
// If a cookies.txt is present on the server (exported from a logged-in
// browser via the "Get cookies.txt" extension / `--cookies-from-browser`),
// it is used automatically.
// Two separate argv entries — execFile does NOT shell-parse, so a single
// string like "--extractor-args youtube:player_client=..." would reach
// yt-dlp as one unknown option ("no such option"). Must be spread.
//
// Client combo: tv_downgraded/web_embedded/android_vr are the most
// reliable from datacenter IPs (the mobile android/ios clients get
// bot-blocked alongside the default web client). player_skip=webpage cuts
// HTTP requests (less rate limiting) and --force-ipv4 avoids IPv6 routing
// issues on cloud hosts. PO tokens come from the bgutil sidecar server
// (see Dockerfile) — the plugin auto-connects to 127.0.0.1:4416.
const YT_EXTRACTOR_ARGS = [
  "--extractor-args",
  "youtube:player_client=tv_downgraded,web_embedded,android_vr;player_skip=webpage",
  "--force-ipv4",
  "--remote-components", "ejs:github",
];
const YT_COOKIES_ARGS = (() => {
  try { return fs.existsSync("/app/cookies.txt") ? ["--cookies", "/app/cookies.txt"] : []; }
  catch { return []; }
})();

// Cloudflare WARP SOCKS5 proxy (wireproxy sidecar, see Dockerfile).
// YouTube bot-blocks raw datacenter IPs even with PO tokens, but not
// Cloudflare's network — routing yt-dlp through :1080 is what actually
// defeats the "Sign in to confirm you're not a bot" block from Render.
// Probed at startup with retries (wireproxy can take a few seconds to
// bind :1080 after the container starts); falls back to direct
// connections if the proxy never comes up (e.g. local dev).
let YT_PROXY_ARGS = [];
let YT_PROXY_LAST_CHECK = null;

function probeWarpProxy() {
  return new Promise((resolve) => {
    const net = require("net");
    let settled = false;
    const finish = (up) => {
      if (settled) return;
      settled = true;
      YT_PROXY_LAST_CHECK = Date.now();
      YT_PROXY_ARGS = up ? ["--proxy", "socks5://127.0.0.1:1080"] : [];
      console.log("[WARP] probe result: " + (up ? "UP — yt-dlp routes via Cloudflare WARP" : "DOWN — yt-dlp connects directly"));
      resolve(up);
    };
    const sock = net.connect({ port: 1080, host: "127.0.0.1" });
    sock.setTimeout(2000);
    sock.on("connect", () => { try { sock.destroy(); } catch {} finish(true); });
    sock.on("error", () => { try { sock.destroy(); } catch {} finish(false); });
    sock.on("timeout", () => { try { sock.destroy(); } catch {} finish(false); });
  });
}

// Retry for up to ~30s at startup — wireproxy binds :1080 shortly after
// the container boots, and the WARP tunnel handshake takes a few seconds.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Growing backoff between yt-dlp retries: the first WARP request after a
// cold start pays the WireGuard handshake latency, so give the second and
// third attempts a real chance instead of a fixed 1s nudge.
const RETRY_DELAYS_MS = [1500, 3000, 5000];
const retryDelayMs = (attempt) => RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];

// Force real traffic through the tunnel so the WireGuard handshake completes
// NOW, not on the user's first song. Without this, the very first yt-dlp
// request through :1080 stalls/fails while the handshake happens.
// Warm BOTH Cloudflare edge and YouTube+GitHub via WARP so the first real
// stream doesn't pay DNS/TLS/handshake for those hosts.
async function warmWarpTunnel() {
  const curlViaWarp = (url) => new Promise((resolve) => {
    execFile("curl", ["-s", "-o", "/dev/null", "-m", "15", "--proxy", "socks5://127.0.0.1:1080", url], (err) => resolve(!err));
  });
  const r1 = await curlViaWarp("https://1.1.1.1/cdn-cgi/trace");
  // Pre-resolve GitHub (ejs:github) and YouTube through the same WARP exit
  // so the first yt-dlp spawn doesn't block on remote EJS fetch + n-solve.
  await Promise.all([
    curlViaWarp("https://raw.githubusercontent.com/yt-dlp/ejs/main/ejs.min.js"),
    curlViaWarp("https://www.youtube.com/generate_204"),
  ]);
  const ok = r1;
  console.log("[WARP] warm-up " + (ok ? "OK — tunnel ready for first request (edge+github+youtube)" : "FAILED — tunnel not ready"));
  return ok;
}

// Re-probe the proxy before a retry: if wireproxy died mid-flight, drop the
// proxy args so the retry goes direct instead of burning attempts through a
// dead tunnel.
async function refreshProxyBeforeRetry() {
  if (YT_PROXY_ARGS.length === 0) return;
  const up = await probeWarpProxy();
  console.log("[WARP] re-probe before retry:", up ? "UP" : "DOWN — retrying direct");
}

(async () => {
  for (let attempt = 1; attempt <= 15; attempt++) {
    const up = await probeWarpProxy();
    if (up) {
      warmWarpTunnel();
      return;
    }
    if (attempt < 15) await sleep(2000);
  }
  console.log("[WARP] Giving up after 15 probes — direct connections only");
})();

// ── yt-dlp concurrency gates ─────────────────────────────────────────────
// Render free tier runs 1 CPU / ~512MB. Under parallel load (observed:
// 8 concurrent audio-info requests) yt-dlp processes starve each other and
// all hit their execFile timeout, while the same calls succeed sequentially
// in ~6s. Two independent lanes prevent stream starvation:
//
//  • metadata lane (YT_DLP_MAX_CONCURRENCY=3) — search/trending/audio-info
//  • stream lane  (STREAM_MAX_CONCURRENCY=2) — /stream and /download pipes
//
// Total max 5, but a stream is never queued behind a search batch. This
// preserves WARP/rate-limit safety while restoring v2.5.16 typing speed
// (3 concurrent searches) and allowing playback+download in parallel.
//
// Priority scheduling (PLAY > PRELOAD > BACKGROUND):
//   PLAY = interactive playback — must not wait behind background work
//   PRELOAD = next-track prefetch — medium, cancellable if stale
//   BACKGROUND = search/trending — lowest, may be starved by PLAY
// Queues are priority-ordered (ascending) with FIFO inside same priority.
const YT_DLP_MAX_CONCURRENCY = 3;
let ytDlpActive = 0;
const ytDlpQueue = [];

const STREAM_MAX_CONCURRENCY = 2;
let streamActive = 0;
const streamQueue = [];

const PRIORITY = { PLAY: 0, PRELOAD: 1, BACKGROUND: 2 };
let queueSeq = 0;

function insertByPriority(queue, item) {
  // priority ascending, seq ascending (FIFO within same priority)
  let idx = queue.findIndex(q => q.priority > item.priority || (q.priority === item.priority && q.seq > item.seq));
  if (idx === -1) queue.push(item);
  else queue.splice(idx, 0, item);
}

function runYtDlp(args, options, callback, priority = PRIORITY.BACKGROUND) {
  const seq = queueSeq++;
  const job = () => {
    ytDlpActive++;
    execFile("yt-dlp", args, options, (err, stdout, stderr) => {
      ytDlpActive--;
      const next = ytDlpQueue.shift();
      if (next) {
        if (next.timer) clearTimeout(next.timer);
        next.job();
      }
      callback(err, stdout, stderr);
    });
  };
  if (ytDlpActive >= YT_DLP_MAX_CONCURRENCY) {
    ytDlpQueue.push({ job, priority, seq, timer: null, id: null });
    // stable sort by priority/seq — keep queue ordered
    // simple insertion sort already via insertByPriority for acquire* paths;
    // for runYtDlp batch push we sort: lowest priority value first
    ytDlpQueue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  } else {
    job();
  }
}

/**
 * Metadata gate for quick execFile jobs (search/trending/audio-info).
 * Spawn-based stream/download jobs use the separate stream lane below.
 * acquireYtSlot/releaseYtSlot remain for metadata; acquireStreamSlot/
 * releaseStreamSlot gate the long-running pipes.
 * opts.priority: PRIORITY.PLAY|PRELOAD|BACKGROUND (default BACKGROUND)
 * opts.id: optional tag for cancellation (e.g. preload:<videoId>)
 */

function acquireYtSlot(cb, opts = {}) {
  const priority = opts.priority ?? PRIORITY.BACKGROUND;
  const seq = queueSeq++;
  const job = () => {
    ytDlpActive++;
    cb();
  };
  if (ytDlpActive >= YT_DLP_MAX_CONCURRENCY) {
    const item = { job, priority, seq, timer: null, id: opts.id || null };
    if (opts.queueTimeoutMs > 0 && typeof opts.onQueuedTooLong === "function") {
      item.timer = setTimeout(() => {
        const idx = ytDlpQueue.indexOf(item);
        if (idx === -1) return;
        ytDlpQueue.splice(idx, 1);
        console.error("[YT Gate] Queued job dropped after", opts.queueTimeoutMs, "ms");
        opts.onQueuedTooLong();
      }, opts.queueTimeoutMs);
    }
    insertByPriority(ytDlpQueue, item);
  } else {
    job();
  }
}

function releaseYtSlot() {
  ytDlpActive--;
  const next = ytDlpQueue.shift();
  if (!next) return;
  if (next.timer) clearTimeout(next.timer);
  next.job();
}

function acquireStreamSlot(cb, opts = {}) {
  const priority = opts.priority ?? PRIORITY.PLAY;
  const seq = queueSeq++;
  const job = () => {
    streamActive++;
    cb();
  };
  if (streamActive >= STREAM_MAX_CONCURRENCY) {
    const item = { job, priority, seq, timer: null, id: opts.id || null };
    if (opts.queueTimeoutMs > 0 && typeof opts.onQueuedTooLong === "function") {
      item.timer = setTimeout(() => {
        const idx = streamQueue.indexOf(item);
        if (idx === -1) return;
        streamQueue.splice(idx, 1);
        console.error("[Stream Gate] Queued job dropped after", opts.queueTimeoutMs, "ms");
        opts.onQueuedTooLong();
      }, opts.queueTimeoutMs);
    }
    insertByPriority(streamQueue, item);
  } else {
    job();
  }
}

function releaseStreamSlot() {
  streamActive--;
  const next = streamQueue.shift();
  if (!next) return;
  if (next.timer) clearTimeout(next.timer);
  next.job();
}

// Cancel queued preloads (stale next-track prefetch) — never cancels a
// running job, only queued. Called when a user skips or starts new PLAY.
function cancelQueuedPreloads() {
  for (let i = streamQueue.length - 1; i >= 0; i--) {
    if (streamQueue[i].priority === PRIORITY.PRELOAD) {
      const item = streamQueue[i];
      if (item.timer) clearTimeout(item.timer);
      streamQueue.splice(i, 1);
      console.log("[Stream Gate] Cancelled stale preload", item.id || "");
    }
  }
  for (let i = ytDlpQueue.length - 1; i >= 0; i--) {
    if (ytDlpQueue[i].priority === PRIORITY.PRELOAD) {
      const item = ytDlpQueue[i];
      if (item.timer) clearTimeout(item.timer);
      ytDlpQueue.splice(i, 1);
      console.log("[YT Gate] Cancelled stale preload", item.id || "");
    }
  }
}

function cancelQueuedById(id) {
  let removed = 0;
  for (const q of [ytDlpQueue, streamQueue]) {
    for (let i = q.length - 1; i >= 0; i--) {
      if (q[i].id === id) {
        if (q[i].timer) clearTimeout(q[i].timer);
        q.splice(i, 1);
        removed++;
      }
    }
  }
  return removed;
}

/**
 * Kill a spawned yt-dlp reliably: SIGTERM first, SIGKILL shortly after.
 * A yt-dlp stuck on a dead socket can ignore SIGTERM forever — without the
 * SIGKILL escalation its 'close' event never fires and the gate slot leaks,
 * wedging ALL subsequent streams/downloads behind the queue.
 */
function killYtProcess(yt) {
  try { yt.kill("SIGTERM"); } catch {}
  setTimeout(() => {
    try { yt.kill("SIGKILL"); } catch {}
  }, 3000);
}

// Standard API response helpers
function ok(res, data, message = "OK") {
  return res.json({ success: true, message, code: "OK", details: data });
}
function fail(res, status, code, message, details = null) {
  return res.status(status).json({ success: false, message, code, details });
}
function err(res, message, details = null) {
  return res.status(500).json({ success: false, message, code: "INTERNAL_ERROR", details });
}

// Rate limiting (simple in-memory)
const rateLimitMap = new Map();
function rateLimit(windowMs = 60000, max = 60) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = rateLimitMap.get(ip);
    if (!entry || now - entry.start > windowMs) {
      rateLimitMap.set(ip, { start: now, count: 1 });
      return next();
    }
    entry.count++;
    if (entry.count > max) {
      return fail(res, 429, "RATE_LIMITED", "Too many requests. Please try again later.", { retryAfterMs: windowMs });
    }
    next();
  };
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [ip, entry] of rateLimitMap) {
    if (entry.start < cutoff) rateLimitMap.delete(ip);
  }
}, 300000);

// Sweep expired stream-cache entries so the byte budget reflects reality.
setInterval(() => {
  const now = Date.now();
  for (const [videoId, entry] of streamCache) {
    if (entry.expiresAt <= now) {
      streamCacheBytes -= entry.data.length;
      streamCache.delete(videoId);
    }
  }
  if (streamCacheBytes < 0) streamCacheBytes = 0;
}, 60000);

// CORS: restrict to known origins
const ALLOWED_ORIGINS = [
  'https://music-app-neon-xi.vercel.app',
  'https://apk-download-page-ruddy.vercel.app',
  'https://musicapp-server-alkf.onrender.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'https://localhost',
  'capacitor://localhost',
  'capacitor://localhost:8080',
  'http://localhost',
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Capacitor native HTTP, etc.)
    // or from known origins.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('[CORS] Blocked origin:', origin);
      callback(null, true); // Be permissive — don't block the app
    }
  },
}));
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    // Don't compress streaming audio downloads — compression corrupts binary data
    if (req.path && req.path.startsWith('/api/download/')) return false;
    return compression.filter(req, res);
  }
}));
app.use(express.json({ limit: '1mb' }));
app.use((_req, res, next) => {
  res.setHeader('Connection', 'keep-alive');
  next();
});
app.use(rateLimit());

const SONGS = require("./server-songs.json");

const seen2 = new Set();
let songs = SONGS.filter(s => { if (seen2.has(s[0])) return false; seen2.add(s[0]); return true; })
  .map((s, i) => ({ id: "yt-" + i, youtubeId: s[0], title: s[1], artist: s[2], genre: s[3], duration: s[4], coverArt: "https://img.youtube.com/vi/" + s[0] + "/mqdefault.jpg" }));

// ── Daily catalog rotation ──────────────────────────────────────────────
// server-songs.json is a static file — without rotation the library would
// show the exact same list every day forever. Each UTC day gets a
// deterministic seeded shuffle of the full catalog: stable within the day
// (safe to cache), different every day (fresh library), every song retained.
const DAY_MS = 24 * 60 * 60 * 1000;

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function dailyShuffledSongs() {
  const dayIndex = Math.floor(Date.now() / DAY_MS);
  const rand = mulberry32(dayIndex);
  const shuffled = songs.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  return shuffled;
}

app.get("/api/songs", (_req, res) => {
  const catalog = dailyShuffledSongs();
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  console.log("[API] GET /api/songs - returning", catalog.length, "songs");
  return ok(res, { songs: catalog, total: catalog.length }, "Songs retrieved successfully");
});
app.get("/api/search", (req, res) => {
  const q = (req.query.q || "").toString().replace(/[^\w\s'!&.+-]/g, "").trim().toLowerCase().slice(0, 100);
  const catalog = dailyShuffledSongs();
  if (!q) return ok(res, { songs: catalog }, "All songs returned (empty query)");
  const results = catalog.filter(s => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q) || s.genre.toLowerCase().includes(q));
  console.log("[API] GET /api/search?q=" + q, "- found", results.length, "results");
  return ok(res, { songs: results }, `Found ${results.length} results for "${q}"`);
});
app.get("/api/genre/:genre", (req, res) => {
  const genre = req.params.genre.toString().replace(/[^\w\s-]/g, "").slice(0, 50);
  const catalog = dailyShuffledSongs();
  const results = catalog.filter(s => s.genre.toLowerCase() === genre.toLowerCase());
  console.log("[API] GET /api/genre/" + genre, "- found", results.length, "songs");
  return ok(res, { songs: results }, `Found ${results.length} songs in genre "${genre}"`);
});

// YouTube Search endpoint
const MUSIC_SKIP_WORDS = [
  'lyrics video', 'lyric video', 'karaoke', 'instrumental', 'cover by',
  'live performance', 'live at', 'performs', 'acoustic session',
  'reaction', 'react to', 'reacting', 'my reaction',
  'interview', 'behind the scenes', 'making of', 'documentary',
  'tutorial', 'how to', 'lesson', 'learn', 'music theory',
  'unboxing', 'vlog', 'day in my life',
  'compilation', 'top 10', 'best of', 'countdown',
  'album mix', 'jukebox', 'full album', 'playlist mix',
  'slowed + reverb', 'slowed and reverb', 'sped up', 'nightcore',
  'mashup', 'remix by', 'bootleg', 'flip',
  'gaming', 'gameplay', 'lets play', 'walkthrough',
  'podcast', 'pod', 'talk show', 'radio show',
  'shorts', 'short', 'ytshorts', 'youtube short',
  'trailer', 'teaser', 'preview', 'snippet',
  'dance tutorial', 'choreography', 'dance practice',
  'cover', 'parody', 'tribute', 'homage',
  'analysis', 'review', 'breakdown', 'explained',
  'audio', 'sound effect', 'sfx', 'ringtone',
  'news', 'update', 'announcement', 'press conference',
  'premiere', 'red carpet', 'awards show', 'concert footage',
  'studio session', 'recording session', 'behind the music',
  'fan made', 'fan edit', 'fan video', 'tribute',
  'lyrics', 'text', 'words', 'subtitles',
  'visualizer', 'visual', 'loops', 'aesthetic',
  '8d audio', '3d audio', 'binaural', 'immersive',
  'bass boosted', 'bass boosted version', 'bass boost',
  'elevator music', 'hold music', 'background music',
  'workout', 'exercise', 'gym', 'running', 'workout motivation',
  'study music', 'lo-fi', 'lofi', 'chill beats', 'relaxing',
  'meditation', 'yoga', 'sleep', 'ambient', 'nature sounds',
  'cooking', 'recipe', 'food', 'restaurant',
  'travel', 'vlog', 'adventure', 'trip', 'journey',
  'fashion', 'makeup', 'beauty', 'skincare', 'outfit',
  'tech', 'gadget', 'review', 'unboxing', 'comparison',
  'car', 'automobile', 'vehicle', 'driving', 'test drive',
  'sports', 'football', 'basketball', 'soccer', 'cricket',
  'fitness', 'workout', 'exercise', 'gym', 'training',
  'comedy', 'funny', 'humor', 'joke', 'prank',
  'news', 'politics', 'current events', 'debate',
  'education', 'lecture', 'tutorial', 'lesson', 'course',
];

function isMusicResult(r) {
  if (!r || !r.id || !r.title) return false;
  const title = r.title || '';
  const artist = r.artist || r.channel || '';
  const lower = (title + ' ' + artist).toLowerCase();

  if (r.duration > 0 && (r.duration < 60 || r.duration > 600)) return false;
  for (const w of MUSIC_SKIP_WORDS) {
    if (lower.includes(w)) return false;
  }
  if (title.length < 3 || title.length > 200) return false;
  if (/^\d+$/.test(title.trim())) return false;
  if (lower.includes('subscribe') && lower.includes('channel')) return false;
  if (r.channel && /compilation|playlist|mix|best of|top \d/i.test(r.channel)) return false;
  return true;
}

function scoreMusicResult(r, query) {
  let score = 0;
  const title = (r.title || '').toLowerCase();
  const channel = (r.channel || '').toLowerCase();
  const artist = (r.artist || '').toLowerCase();
  const q = (query || '').toLowerCase();
  const qWords = q.split(/\s+/).filter(w => w.length > 2);

  if (/\b(official|official music video|official video|official audio)\b/.test(title)) score += 50;
  if (/\b(topic|vevo)\b/.test(channel)) score += 40;
  if (/\b(topic|vevo)\b/.test(title)) score += 30;
  if (r.channel_is_verified) score += 20;
  if (/official\s*(audio|video|music video)/.test(title)) score += 25;
  if (/\b(lyric video|visualizer|official visual)\b/.test(title)) score += 15;

  const qInTitle = qWords.filter(w => title.includes(w)).length;
  score += qInTitle * 15;

  const exactTitleMatch = title.includes(q);
  if (exactTitleMatch) score += 60;

  const titleStartsWithQuery = title.startsWith(q);
  if (titleStartsWithQuery) score += 20;

  if (r.duration > 120 && r.duration < 480) score += 20;
  else if (r.duration >= 180 && r.duration <= 360) score += 10;

  const views = r.viewCount || r.view_count || 0;
  if (views > 1000000000) score += 40;
  else if (views > 100000000) score += 30;
  else if (views > 10000000) score += 20;
  else if (views > 1000000) score += 10;
  else if (views > 100000) score += 5;

  if (/\b(song|music|audio|official)\b/.test(title)) score += 10;
  if (!/\b(live|concert|tour|festival|acoustic|unplugged)\b/.test(title)) score += 5;
  if (/\b(explicit|clean)\b/.test(title)) score += 3;

  if (/\b(live|concert|tour|festival|acoustic|unplugged|performs|session)\b/.test(title)) score -= 30;
  if (/\b(fan|edit|tribute|cover|parody|mashup|remix)\b/.test(channel)) score -= 20;
  if (/\b(sports|football|basketball|soccer|cricket|goals|skills)\b/.test(title)) score -= 40;

  return score;
}

function extractAlbum(title) {
  const albumMatch = title.match(/(?:from|off|album)[\s:]+["']?([^"'\)]+)["']?/i);
  if (albumMatch) return albumMatch[1].trim();
  const parenMatch = title.match(/\(([^)]+)\)/);
  if (parenMatch && /\b(album|ep|lp|deluxe|edition|version|remaster)\b/i.test(parenMatch[1])) {
    return parenMatch[1].trim();
  }
  return '';
}

// ── Server-side search cache ───────────────────────────────────────────────
// yt-dlp search through yt-dlp takes 5-15s. Caching avoids redundant
// searches for the same query within a short window. Bounded LRU + TTL so a
// search storm can never grow memory unboundedly (this cache is a few KB per
// entry — never a memory risk like the stream cache).
const ytSearchCache = new Map(); // key -> { results, expiresAt }
const YT_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const YT_SEARCH_CACHE_MAX = 100;

app.get("/api/youtube/search", (req, res) => {
  const q = (req.query.q || "").toString().replace(/[^\w\s'!&.+-]/g, "").trim().slice(0, 100);
  if (!q) return ok(res, { results: [] }, "Empty query, returned empty results");

  // Check cache first — instant response for repeat searches
  const cacheKey = q.toLowerCase();
  const cached = ytSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    console.log("[YT Search] Cache hit for:", q);
    return ok(res, { results: cached.results }, `Cached ${cached.results.length} results for "${q}"`);
  }
  if (cached) ytSearchCache.delete(cacheKey);

  console.log("[YT Search] Searching for:", q);

  const hasSongWord = /\b(song|music|audio|video)\b/i.test(q);
  const musicQuery = hasSongWord ? q : q + " music";

  const attemptSearch = (attempt = 1) => {
    const maxAttempts = 2;

    runYtDlp([
      "ytsearch25:" + musicQuery,
      "--flat-playlist",
      "--dump-json",
      "--no-warnings",
      "--no-check-certificates",
      "--age-limit", "18",
      ...YT_EXTRACTOR_ARGS,
      ...YT_COOKIES_ARGS,
      ...YT_PROXY_ARGS,
      "--match-filters", "!is_live & !was_live & duration>?60 & duration<?600",
    ], { timeout: 35000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        console.error("[YT Search] Error:", err.message, "attempt", attempt);
        if (attempt < maxAttempts) {
          return setTimeout(async () => {
            await refreshProxyBeforeRetry();
            attemptSearch(attempt + 1);
          }, retryDelayMs(attempt));
        }
        return fail(res, 502, "YT_DLP_ERROR", "YouTube search failed", { detail: err.message, stderr: stderr?.slice(0, 500) });
      }
      try {
        const lines = stdout.trim().split("\n").filter(Boolean);
        const results = [];
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            const entry = {
              id: data.id || data.url,
              title: data.title || "Unknown",
              artist: data.channel || data.uploader || "Unknown",
              duration: data.duration || 0,
              thumbnail: data.thumbnails?.[data.thumbnails.length - 1]?.url || "https://img.youtube.com/vi/" + (data.id || "") + "/mqdefault.jpg",
              viewCount: data.view_count || 0,
              channel_is_verified: data.channel_is_verified || false,
              album: extractAlbum(data.title || ''),
            };
            if (entry.id && isMusicResult(entry)) {
              entry.score = scoreMusicResult(entry, q);
              results.push(entry);
            }
          } catch (parseErr) {
            console.error("[YT Search] Skipping malformed line:", parseErr.message);
          }
        }
        results.sort((a, b) => (b.score || 0) - (a.score || 0));
        const top = results.slice(0, 20);
        for (const r of top) delete r.score;
        console.log("[YT Search] Found", top.length, "music results for:", q);
        // Cache the results for instant repeat searches (LRU-bounded).
        if (top.length > 0) {
          if (ytSearchCache.size >= YT_SEARCH_CACHE_MAX) {
            const oldest = ytSearchCache.keys().next().value;
            if (oldest !== undefined) ytSearchCache.delete(oldest);
          }
          ytSearchCache.set(cacheKey, { results: top, expiresAt: Date.now() + YT_SEARCH_CACHE_TTL_MS });
        }
        return ok(res, { results: top }, `Found ${top.length} results for "${q}"`);
      } catch (e) {
        console.error("[YT Search] Parse error:", e.message);
        return fail(res, 500, "PARSE_ERROR", "Failed to parse search results", { detail: e.message });
      }
    });
  };

  attemptSearch();
});

// ── Trending system ───────────────────────────────────────────────────────
let trendingCache = null;
let trendingCacheTime = 0;
let trendingSource = 'none';
let pendingTrendingFetch = null;
let lastTrendingAttempt = 0;

const TRENDING_YT_QUERIES = [
  "youtube music trending",
  "top 50 songs this week",
  "billboard hot 100",
  "most popular songs right now",
  "viral hits 2026",
  "new music friday",
  "top hits today",
];

const CHARTS_QUERIES = [
  "official uk top 40",
  "billboard 200 albums",
  "spotify top 50 global",
  "indian top 10 songs",
  "bollywood top hits",
];

const CHARTS_CACHE_TTL = 30 * 60 * 1000;

function runYtDlpSearch(query, maxResults = 8) {
  return new Promise((resolve) => {
    // Deliberately NOT through the user-facing concurrency gate: trending
    // runs batches of parallel searches inside a 45-60s budget, and the
    // gate (max 2) serialized them past the deadline, forcing the builtin
    // fallback. Background trending is allowed to run in parallel.
    execFile("yt-dlp", [
      `ytsearch${maxResults}:${query}`,
      "--flat-playlist",
      "--dump-json",
      "--no-warnings",
      "--no-check-certificates",
      "--age-limit", "18",
      ...YT_EXTRACTOR_ARGS,
      ...YT_COOKIES_ARGS,
      ...YT_PROXY_ARGS,
      "--match-filters", "!is_live & !was_live & duration>?60 & duration<?600",
    ], { timeout: 25000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      try {
        const lines = stdout.trim().split("\n").filter(Boolean);
        const results = [];
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.id && data.title) {
              const entry = {
                id: data.id,
                title: data.title || "Unknown",
                artist: data.channel || data.uploader || "Unknown",
                duration: data.duration || 0,
                thumbnail: data.thumbnails?.[data.thumbnails.length - 1]?.url || "https://img.youtube.com/vi/" + data.id + "/mqdefault.jpg",
                viewCount: data.view_count || 0,
                channel_is_verified: data.channel_is_verified || false,
              };
              if (isMusicResult(entry)) results.push(entry);
            }
          } catch (lineErr) {
            console.error("[YT Trending] Skipping malformed line:", lineErr.message);
          }
        }
        resolve(results);
      } catch (e) {
        console.error("[YT Trending] Failed to parse output for query:", query, e.message);
        resolve([]);
      }
    });
  });
}

async function fetchLiveTrending() {
  const allResults = [];
  const seen = new Set();

  const batchSize = 3;
  for (let i = 0; i < TRENDING_YT_QUERIES.length; i += batchSize) {
    const batch = TRENDING_YT_QUERIES.slice(i, i + batchSize);
    const promises = batch.map(q => runYtDlpSearch(q, 8));
    const batchResults = await Promise.all(promises);
    for (const results of batchResults) {
      for (const r of results) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          allResults.push(r);
        }
      }
    }
    // If we already have enough results, don't waste time on remaining batches
    if (allResults.length >= 15) break;
  }

  if (allResults.length > 0) {
    allResults.sort((a, b) => {
      let sa = 0, sb = 0;
      if (/\b(official|topic|vevo)\b/.test((a.title + ' ' + a.artist).toLowerCase())) sa += 50;
      if (/\b(official|topic|vevo)\b/.test((b.title + ' ' + b.artist).toLowerCase())) sb += 50;
      if (a.viewCount > 100000000) sa += 30;
      if (b.viewCount > 100000000) sb += 30;
      if (a.duration > 120 && a.duration < 480) sa += 15;
      if (b.duration > 120 && b.duration < 480) sb += 15;
      return sb - sa;
    });
  }

  return allResults;
}

async function fetchOfficialCharts() {
  const allResults = [];
  const seen = new Set();

  const batchSize = 3;
  for (let i = 0; i < CHARTS_QUERIES.length; i += batchSize) {
    const batch = CHARTS_QUERIES.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(q => runYtDlpSearch(q, 5)));
    for (const results of batchResults) {
      for (const r of results) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          allResults.push(r);
        }
      }
    }
  }

  return allResults;
}

function getBuiltInFallback() {
  return songs.slice(0, 30).map(s => ({
    id: s.youtubeId,
    title: s.title,
    artist: s.artist,
    duration: s.duration,
    thumbnail: s.coverArt,
    viewCount: 0,
    channel_is_verified: false,
  }));
}

async function doFetchTrending() {
  const startMs = Date.now();
  // 60s: trending searches run in parallel (not gated), and WARP adds
  // latency — 45s was too tight after the WARP switch.
  const OVERALL_TIMEOUT_MS = 60_000;
  console.log("[Trending] Starting live fetch...");

  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);

  try {
    console.log("[Trending] Step 1: Fetching live YouTube Music trending...");
    const liveResults = await withTimeout(fetchLiveTrending(), OVERALL_TIMEOUT_MS);
    console.log("[Trending] Step 1 got", liveResults.length, "results");
    if (liveResults.length >= 5) {
      const elapsed = Date.now() - startMs;
      console.log("[Trending] LIVE_YOUTUBE: Got", liveResults.length, "results in", elapsed, "ms");
      return { results: liveResults, source: 'youtube_music', fromCache: false };
    }

    console.log("[Trending] Step 2: Fetching official charts...");
    const remaining = Math.max(1, OVERALL_TIMEOUT_MS - (Date.now() - startMs));
    const chartResults = await withTimeout(fetchOfficialCharts(), remaining);
    console.log("[Trending] Step 2 got", chartResults.length, "chart results");
    const merged = [...liveResults, ...chartResults];
    const deduped = [];
    const seen = new Set();
    for (const r of merged) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        deduped.push(r);
      }
    }
    console.log("[Trending] Merged:", deduped.length, "deduplicated results");
    if (deduped.length >= 5) {
      const elapsed = Date.now() - startMs;
      console.log("[Trending] LIVE_YOUTUBE: Got", deduped.length, "results in", elapsed, "ms");
      return { results: deduped, source: 'charts', fromCache: false };
    }

    console.log("[Trending] Step 3: Checking cache...");
    if (trendingCache && trendingCache.length > 0) {
      console.log("[Trending] CACHED_YOUTUBE: cache echo:", trendingCache.length, "songs from", trendingSource);
      // Preserve the TRUE origin — a cache echo must never be relabeled 'cache'
      return { results: trendingCache, source: trendingSource, fromCache: true };
    }

    console.log("[Trending] BUILT_IN_FALLBACK: Using built-in fallback");
    return { results: getBuiltInFallback(), source: 'builtin', fromCache: true };
  } catch (err) {
    console.error("[Trending] Error:", err.message);
    if (trendingCache && trendingCache.length > 0) {
      console.log("[Trending] CACHED_YOUTUBE: error fallback using cache:", trendingCache.length, "songs");
      return { results: trendingCache, source: trendingSource, fromCache: true };
    }
    console.log("[Trending] BUILT_IN_FALLBACK: error fallback using built-in");
    return { results: getBuiltInFallback(), source: 'builtin', fromCache: true };
  }
}

/**
 * Kick off a single in-flight live fetch. Only GENUINE live results
 * (youtube_music/charts, non-empty, not echoed from our own cache) are
 * written into the server cache — fallbacks and cache echoes must never
 * overwrite valid live data or masquerade as fresh later.
 */
function startPendingFetch() {
  if (pendingTrendingFetch) return pendingTrendingFetch;
  lastTrendingAttempt = Date.now();
  pendingTrendingFetch = doFetchTrending()
    .then(result => {
      const isLive = result.source === 'youtube_music' || result.source === 'charts';
      if (isLive && !result.fromCache && result.results.length > 0) {
        trendingCache = result.results.slice(0, 40);
        trendingCacheTime = Date.now();
        trendingSource = result.source;
      }
      return result;
    })
    .finally(() => { pendingTrendingFetch = null; });
  return pendingTrendingFetch;
}

/**
 * Stale-while-revalidate:
 *  - fresh cache  → serve immediately (fresh:true)
 *  - stale cache  → serve it immediately, honestly flagged fresh:false,
 *                   while a background refresh runs
 *  - no cache     → the ONLY case where the request blocks on a live fetch
 */
async function ensureTrending() {
  const now = Date.now();
  const hasCache = trendingCache && trendingCache.length > 0;
  const cacheFresh = hasCache && (now - trendingCacheTime) < CHARTS_CACHE_TTL;

  if (cacheFresh) {
    return { results: trendingCache, source: trendingSource, lastUpdated: trendingCacheTime, fresh: true };
  }

  if (hasCache) {
    startPendingFetch(); // background refresh lands in cache for the next request
    return { results: trendingCache, source: trendingSource, lastUpdated: trendingCacheTime, fresh: false };
  }

  try {
    const result = await startPendingFetch();
    const isLive = result.source === 'youtube_music' || result.source === 'charts';
    const fresh = isLive && !result.fromCache && result.results.length > 0;
    return { results: result.results, source: result.source, lastUpdated: fresh ? trendingCacheTime : Date.now(), fresh };
  } catch {
    return { results: getBuiltInFallback(), source: 'builtin', lastUpdated: Date.now(), fresh: false };
  }
}

// ── Shared trending endpoint (used by both /api/youtube/trending and /api/charts/trending.json) ──
app.get("/api/youtube/trending", async (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  try {
    const data = await ensureTrending();
    return ok(res, { results: data.results, source: data.source, lastUpdated: data.lastUpdated, fresh: data.fresh }, `Trending from ${data.source}${data.fresh ? '' : ' (stale)'}`);
  } catch (err) {
    console.error("[Trending] Endpoint error:", err.message);
    const fallback = getBuiltInFallback();
    return ok(res, { results: fallback, source: 'builtin', lastUpdated: Date.now(), fresh: false }, "Trending fallback (error)");
  }
});

// Fast endpoint — returns cache immediately, triggers background fetch if stale
app.get("/api/charts/trending.json", async (req, res) => {
  console.log("[Charts] GET /api/charts/trending.json — cache:", trendingCache ? trendingCache.length : 0, "source:", trendingSource);
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");

  try {
    const data = await ensureTrending();
    return ok(res, { results: data.results, source: data.source, lastUpdated: data.lastUpdated, fresh: data.fresh }, `Trending from ${data.source}${data.fresh ? '' : ' (stale)'}`);
  } catch (err) {
    console.error("[Charts] Endpoint error:", err.message);
    // Do NOT write fallback to trendingCache — that poisons it for 30 minutes.
    // Return whatever cache we have, or builtin without caching it.
    const fallback = trendingCache && trendingCache.length > 0
      ? trendingCache
      : getBuiltInFallback();
    const src = trendingCache && trendingCache.length > 0 ? trendingSource : 'builtin';
    return ok(res, { results: fallback, source: src, lastUpdated: trendingCacheTime || Date.now(), fresh: false }, `Trending fallback (${src})`);
  }
});

app.get("/api/health", (req, res) => {
  console.log("[API] GET /api/health");
  const start = Date.now();
  execFile("yt-dlp", ["--version"], (err, stdout) => {
    const ytDlpVersion = stdout ? stdout.trim() : "unavailable";
    const ytDlpHealthy = !err;
    const mem = process.memoryUsage();
    const uptime = process.uptime();
    return ok(res, {
      status: ytDlpHealthy ? "healthy" : "degraded",
      services: {
        ytDlp: { available: ytDlpHealthy, version: ytDlpVersion },
        express: { available: true, version: require("express/package.json").version },
      },
      warp: {
        enabled: YT_PROXY_ARGS.length > 0,
        proxyArgs: YT_PROXY_ARGS,
        lastCheck: YT_PROXY_LAST_CHECK ? new Date(YT_PROXY_LAST_CHECK).toISOString() : null,
      },
      trending: {
        cached: !!(trendingCache && trendingCache.length > 0),
        source: trendingSource || "none",
        count: trendingCache ? trendingCache.length : 0,
        lastUpdated: trendingCacheTime || null,
      },
      songs: {
        count: songs.length,
        genres: [...new Set(songs.map(s => s.genre))],
      },
      system: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        memory: {
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + "MB",
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + "MB",
          rss: Math.round(mem.rss / 1024 / 1024) + "MB",
          external: Math.round(mem.external / 1024 / 1024) + "MB",
        },
        uptime: Math.round(uptime) + "s",
        pid: process.pid,
      },
      streamCache: {
        memoryHits: streamCacheStats.memoryHits,
        diskHits: streamCacheStats.diskHits,
        misses: streamCacheStats.misses,
        preloads: streamCacheStats.preloads,
        hitRate: ((streamCacheStats.memoryHits + streamCacheStats.diskHits) / Math.max(1, streamCacheStats.memoryHits + streamCacheStats.diskHits + streamCacheStats.misses) * 100).toFixed(1) + '%',
        memoryBytes: streamCacheBytes,
        memoryEntries: streamCache.size,
      },
      responseTimeMs: Date.now() - start,
    }, "Health check complete");
  });
});

// ── Stream audio cache ─────────────────────────────────────────────────────
// Store recently streamed audio so repeat plays are instant. Memory on the
// free Render tier is ~512MB — buffering EVERY full song (the old behavior:
// 50 entries x 5-8MB = up to 400MB) OOMs the server, which is what made
// playback/search/downloads hang. The cache is now byte-budgeted: only
// small tracks are buffered, and the total is capped hard so the heap can
// never be exhausted by cached audio.
const streamCache = new Map(); // videoId -> { data: Buffer, mime: string, expiresAt: number }
const STREAM_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const STREAM_CACHE_MAX_ENTRY_BYTES = 10 * 1024 * 1024; // songs <= 10MB are cached in memory
const STREAM_CACHE_MAX_TOTAL_BYTES = 50 * 1024 * 1024; // hard heap budget for the cache
let streamCacheBytes = 0;

// ── Cache stats (for observability) ────────────────────────────────────────
const streamCacheStats = { memoryHits: 0, diskHits: 0, misses: 0, preloads: 0 };

// ── Persistent file cache ──────────────────────────────────────────────────
const STREAM_DISK_CACHE_DIR = "/tmp/stream-cache";
const STREAM_DISK_CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours — keeps playlist hits warm across sessions
// Survives server restarts. Stores to /tmp/stream-cache/<videoId>.{webm,m4a,mp3}
// Uses symlinks for atomic writes. Max 200MB total on disk.
function initDiskCache() {
  try {
    if (!fs.existsSync(STREAM_DISK_CACHE_DIR)) {
      fs.mkdirSync(STREAM_DISK_CACHE_DIR, { recursive: true });
    }
  } catch {}
}

function getDiskCachePath(videoId, mime) {
  const ext = mime === "audio/mpeg" ? "mp3" : mime === "audio/mp4" ? "m4a" : "webm";
  return path.join(STREAM_DISK_CACHE_DIR, `${videoId}.${ext}`);
}

function getDiskCacheMetaPath(videoId) {
  return path.join(STREAM_DISK_CACHE_DIR, `${videoId}.meta`);
}

async function readDiskCache(videoId) {
  try {
    const metaPath = getDiskCacheMetaPath(videoId);
    try { await fs.promises.access(metaPath); } catch { return null; }
    const raw = await fs.promises.readFile(metaPath, "utf8");
    const meta = JSON.parse(raw);
    if (Date.now() > meta.expiresAt) return null;
    const filePath = getDiskCachePath(videoId, meta.mime);
    try { await fs.promises.access(filePath); } catch { return null; }
    return { filePath, mime: meta.mime, size: meta.size };
  } catch {
    return null;
  }
}

function writeDiskCache(videoId, data, mime) {
  try {
    if (data.length > 50 * 1024 * 1024) return; // don't cache >50MB files to disk
    const filePath = getDiskCachePath(videoId, mime);
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, filePath); // atomic
    const meta = { mime, size: data.length, expiresAt: Date.now() + STREAM_DISK_CACHE_MAX_AGE_MS };
    fs.writeFileSync(getDiskCacheMetaPath(videoId), JSON.stringify(meta));
    // Enforce disk budget
    enforceDiskCacheBudget();
    console.log("[Stream] Disk cached", data.length, "bytes for:", videoId);
  } catch (e) {
    console.error("[Stream] Disk cache write failed:", e.message);
  }
}

function enforceDiskCacheBudget() {
  try {
    const files = fs.readdirSync(STREAM_DISK_CACHE_DIR)
      .filter(f => f.endsWith(".meta"))
      .map(f => {
        const metaPath = path.join(STREAM_DISK_CACHE_DIR, f);
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        const filePath = path.join(STREAM_DISK_CACHE_DIR, f.replace(".meta", ""));
        return { metaPath, filePath, size: meta.size, expiresAt: meta.expiresAt };
      })
      .filter(f => fs.existsSync(f.filePath) && Date.now() <= f.expiresAt)
      .sort((a, b) => a.expiresAt - b.expiresAt);

    let total = files.reduce((sum, f) => sum + f.size, 0);
    for (const f of files) {
      if (total <= STREAM_DISK_CACHE_MAX_BYTES) break;
      try {
        fs.unlinkSync(f.filePath);
        fs.unlinkSync(f.metaPath);
        total -= f.size;
        console.log("[Stream] Disk cache evicted:", path.basename(f.filePath));
      } catch {}
    }
  } catch {}
}

initDiskCache();

// Cleanup on startup
enforceDiskCacheBudget();

function cacheStreamEntry(videoId, data, mime) {
  if (data.length > STREAM_CACHE_MAX_ENTRY_BYTES) return; // too big — never buffer
  while (streamCacheBytes + data.length > STREAM_CACHE_MAX_TOTAL_BYTES) {
    const oldest = streamCache.keys().next().value;
    if (oldest === undefined) return;
    const evicted = streamCache.get(oldest);
    streamCacheBytes -= evicted.data.length;
    streamCache.delete(oldest);
  }
  streamCache.set(videoId, { data, mime, expiresAt: Date.now() + STREAM_CACHE_TTL_MS });
  streamCacheBytes += data.length;
  console.log("[Stream] Cached", data.length, "bytes for:", videoId, "(cache total:", streamCacheBytes, "bytes)");
  // Also write to persistent disk cache
  writeDiskCache(videoId, data, mime);
}

// Audio streaming endpoint - streams audio from YouTube
app.get("/api/stream/:videoId", async (req, res) => {
  const videoId = req.params.videoId;
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return fail(res, 400, "INVALID_VIDEO_ID", "Invalid video ID format", { videoId });
  }

  const audioUrl = "https://www.youtube.com/watch?v=" + videoId;

  // Check memory cache first — instant response for repeat plays.
  const cached = streamCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) {
    streamCacheStats.memoryHits++;
    console.log("[Stream] Memory cache hit for:", videoId, "bytes:", cached.data.length, "mime:", cached.mime, "(stats:", JSON.stringify(streamCacheStats) + ")");
    res.setHeader("Content-Type", cached.mime);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=900");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Length", cached.data.length);
    return res.end(cached.data);
  }

  // Check persistent disk cache — survives server restarts, instant for previously played songs
  // Async file I/O so the event loop isn't blocked before the stream gate.
  const diskCached = await readDiskCache(videoId);
  if (diskCached) {
    streamCacheStats.diskHits++;
    console.log("[Stream] Disk cache hit for:", videoId, "bytes:", diskCached.size, "mime:", diskCached.mime, "(stats:", JSON.stringify(streamCacheStats) + ")");
    res.setHeader("Content-Type", diskCached.mime);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=900");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Length", diskCached.size);
    // Stream from file (don't load entire file into memory)
    const fileStream = fs.createReadStream(diskCached.filePath);
    fileStream.pipe(res);
    // Also populate memory cache for next request
    if (diskCached.size <= STREAM_CACHE_MAX_ENTRY_BYTES) {
      const chunks = [];
      fileStream.on("data", (chunk) => chunks.push(chunk));
      fileStream.on("end", () => {
        const data = Buffer.concat(chunks);
        cacheStreamEntry(videoId, data, diskCached.mime);
      });
    }
    return;
  }

  const isPreload = req.headers['x-preload'] === '1' || req.query.preload === '1';
  if (!isPreload) {
    // Stale preloads for a previous track must not run if user already
    // pressed Play on a new track — cancel queued PRELOAD jobs so PLAY
    // jumps ahead without wasting the stream slot.
    cancelQueuedPreloads();
  }
  streamCacheStats.misses++;
  if (isPreload) streamCacheStats.preloads++;
  console.log(`[Stream] Starting ${isPreload ? 'preload' : 'stream'} for:`, videoId, `(stats: ${JSON.stringify(streamCacheStats)})`);

  const attemptStream = (attempt = 1) => {
    const maxAttempts = 3;

    // Pin to m4a 140 first — fastest manifest parse, known MIME (audio/mp4).
    // Fallback chain kept short; large sorting over webm/opus added ~800ms.
    const ytArgs = [
      "-f", "140/bestaudio[ext=m4a]/bestaudio",
      "-o", "-",
      "--no-check-certificates",
      "--no-warnings",
      "--no-playlist",
      "--no-part",
      "--age-limit", "18",
      ...YT_EXTRACTOR_ARGS,
      ...YT_COOKIES_ARGS,
      ...YT_PROXY_ARGS,
      "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      audioUrl
    ];

    console.log(`[Stream] Attempt ${attempt}/${maxAttempts} for: ${videoId} — acquiring stream slot (active: ${streamActive}, queued: ${streamQueue.length}) ${isPreload ? '[PRELOAD]' : '[PLAY]'}`);
    // Stream lane — PLAY > PRELOAD priority, dedicated gate so search never queues first play.
    // isPreload jobs use PRELOAD priority so a PLAY arriving later jumps ahead.
    acquireStreamSlot(() => {
    const yt = spawn("yt-dlp", ytArgs, { stdio: ["ignore", "pipe", "pipe"] });

    let headersSent = false;
    // Send headers immediately so client TTFB isn't gated on MIME sniff or
    // yt-dlp manifest parse. MIME is corrected on first chunk if needed.
    // This removes ~200ms + format-sort time from critical path.
    if (!res.headersSent) {
      res.setHeader("Content-Type", "audio/mp4");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    // 'error' AND 'close' may BOTH fire for one process — release exactly once.
    let slotReleased = false;
    const releaseSlotOnce = () => {
      if (slotReleased) return;
      slotReleased = true;
      releaseStreamSlot();
    };
    const retryStream = (delayMs) => {
      console.log("[Stream] Retrying with different clients... attempt", attempt + 1, "for:", videoId);
      setTimeout(async () => {
        await refreshProxyBeforeRetry();
        attemptStream(attempt + 1);
      }, delayMs);
    };
    // 15s covers yt-dlp extraction on a warm instance (~3-6s) with headroom;
    // the client-side canplay timeout (8s) races this, so keeping it tight
    // ensures fast failure → recovery on the client side.
    let startupTimeout = setTimeout(() => {
      if (!headersSent) {
        killYtProcess(yt);
        if (!res.headersSent) {
          console.error("[Stream] Timed out after 15s for:", videoId, "attempt", attempt);
          if (attempt < maxAttempts) {
            retryStream(retryDelayMs(attempt));
          } else {
            fail(res, 504, "STREAM_TIMEOUT", "Stream timed out after retries", { videoId, attempts: maxAttempts, detail: stderrOutput.slice(0, 2000) });
          }
        }
      }
    }, 15000);

    let firstChunk = true;
    let totalBytes = 0;
    let detectedMime = "audio/webm";
    // Buffer ONLY for caching — bounded by the entry-size cap so a long
    // track is never held in heap. Nothing is buffered unless it can be
    // cached, so the server can't accumulate memory on long streams.
    let cacheable = true;
    const audioChunks = []; // buffer for caching (only if within budget)
    yt.stdout.on("data", (chunk) => {
      if (firstChunk) {
        firstChunk = false;
        headersSent = true;
        clearTimeout(startupTimeout);
        // Detect MIME from first chunk magic bytes for logging/cache.
        // Headers already sent as audio/mp4 — only log actual MIME.
        if (chunk.length >= 4) {
          if (chunk[0] === 0x49 && chunk[1] === 0x44 && chunk[2] === 0x33) detectedMime = "audio/mpeg";
          else if (chunk[0] === 0xFF && (chunk[1] === 0xFB || chunk[1] === 0xF3 || chunk[1] === 0xF2)) detectedMime = "audio/mpeg";
          else if (chunk.length >= 8 && chunk[4] === 0x66 && chunk[5] === 0x74 && chunk[6] === 0x79 && chunk[7] === 0x70) detectedMime = "audio/mp4";
          else if (chunk[0] === 0x1A && chunk[1] === 0x45 && chunk[2] === 0xDF && chunk[3] === 0xA3) detectedMime = "audio/webm";
          else detectedMime = "audio/mpeg";
        }
        console.log("[Stream] First chunk received for:", videoId, "MIME:", detectedMime);
      }
      totalBytes += chunk.length;
      if (cacheable) {
        if (totalBytes > STREAM_CACHE_MAX_ENTRY_BYTES) {
          cacheable = false; // too big to cache — stop buffering immediately
          audioChunks.length = 0;
        } else {
          audioChunks.push(chunk);
        }
      }
      res.write(chunk);
    });

    let stderrOutput = "";
    yt.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.error("[Stream]", msg);
      stderrOutput += msg + "\n";
    });

    yt.on("error", (err) => {
      clearTimeout(startupTimeout);
      releaseSlotOnce();
      console.error("[Stream] Process error:", err.message, "attempt", attempt);
      if (!res.headersSent) {
        if (attempt < maxAttempts) {
          retryStream(retryDelayMs(attempt));
        } else {
          fail(res, 500, "STREAM_ERROR", "Stream process failed after retries", { videoId, detail: err.message, attempts: maxAttempts });
        }
      }
    });

    yt.on("close", (code) => {
      clearTimeout(startupTimeout);
      releaseSlotOnce();
      if (code && code !== 0 && !headersSent) {
        console.error("[Stream] yt-dlp exited with code:", code, "for:", videoId, "attempt", attempt);
        if (!res.headersSent) {
          if (attempt < maxAttempts) {
            console.log("[Stream] Retrying with different clients... attempt", attempt + 1);
            setTimeout(() => attemptStream(attempt + 1), 1500);
          } else {
            fail(res, 500, "STREAM_FAILED", "Stream failed after retries", { videoId, code, detail: stderrOutput.slice(0, 2000), attempts: maxAttempts });
          }
        }
      } else if (headersSent) {
        if (code && code !== 0) {
          console.error("[Stream] Exited with non-zero code:", code, "for:", videoId, "bytes:", totalBytes, "(partial stream)");
        } else {
          console.log("[Stream] Completed for:", videoId, "bytes:", totalBytes, "MIME:", detectedMime);
          // Cache the audio data for instant repeat plays — only when it was
          // fully buffered within the entry-size budget.
          if (cacheable && audioChunks.length > 0 && totalBytes > 1024) {
            const cacheData = Buffer.concat(audioChunks);
            cacheStreamEntry(videoId, cacheData, detectedMime);
          }
        }
        res.end();
      }
    });

    req.on("close", () => {
      clearTimeout(startupTimeout);
      // Preload is cancellable via queue; if its HTTP request is aborted
      // (client-side AbortController), kill its yt-dlp to free the slot.
      // Play requests also kill on close, but a preload must never keep a
      // slot occupied after the user skipped.
      killYtProcess(yt);
    });
    }, {
      queueTimeoutMs: 90_000,
      priority: isPreload ? PRIORITY.PRELOAD : PRIORITY.PLAY,
      id: isPreload ? `preload:${videoId}` : `play:${videoId}`,
      onQueuedTooLong: () => {
        console.error(`[Stream] QUEUE_TIMEOUT ${isPreload ? 'preload' : 'play'}:`, videoId);
        if (!res.headersSent) fail(res, 503, "STREAM_BUSY", "Server is busy — try again shortly", { videoId });
      },
    });
  };

  attemptStream();
});

// Download endpoint - returns audio file for download
// Skip compression for this route — compression middleware interferes with
// streaming audio responses and can cause 0-byte or truncated downloads.
app.get("/api/download/:videoId", (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Pragma", "no-cache");
  const videoId = req.params.videoId;
  const title = req.query.title || "song";
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return fail(res, 400, "INVALID_VIDEO_ID", "Invalid video ID");
  }

  console.log("[Download] DOWNLOAD_START", { videoId, title });

  // Non-ASCII titles (e.g. Hindi) would otherwise sanitize to an empty
  // string and produce a bogus ".mp3" attachment name — fall back to the
  // video id so the filename is always meaningful.
  const safeName = title.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_").substring(0, 80) || videoId;
  const audioUrl = "https://www.youtube.com/watch?v=" + videoId;

  let attempt = 1;
  const maxAttempts = 3;
  const MIN_BYTES = 10240;

  // Only one yt-dlp process may be in flight for this request at a time. The
  // old code let 'error' AND 'close' each schedule a retry, spawning two
  // concurrent chains that raced on a single HTTP response — whichever
  // finished second committed headers after the response had already ended.
  let attemptInFlight = false;
  // A client disconnect destroys the response; writing/ending it afterwards
  // would raise an unhandled 'error'. This listener swallows those safely.
  res.on("error", () => {});

  const attemptDownload = () => {
    if (attemptInFlight) {
      console.error("[Download] Overlapping attempt skipped for:", videoId);
      return;
    }
    attemptInFlight = true;

    let totalBytes = 0;
    let stderrOutput = "";
    let killed = false;
    let settled = false;
    const buffer = [];

    console.log("[Download] SOURCE_RESOLUTION", { videoId, attempt });

    const ytArgs = [
      "-f", "140/bestaudio[ext=m4a]/bestaudio",
      "-o", "-",
      "--no-check-certificates",
      "--no-warnings",
      "--no-playlist",
      "--no-part",
      "--age-limit", "18",
      ...YT_EXTRACTOR_ARGS,
      ...YT_COOKIES_ARGS,
      ...YT_PROXY_ARGS,
      "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      audioUrl
    ];

    console.log("[Download] SOURCE_RESOLVED", { videoId, attempt, format: ytArgs[1] });
    console.log("[Download] YT_DLP_START", { videoId, attempt, active: streamActive, queued: streamQueue.length });
    // Stream lane — downloads share the stream gate, never starve searches.
    acquireStreamSlot(() => {
    const yt = spawn("yt-dlp", ytArgs, { stdio: ["ignore", "pipe", "pipe"] });

    // 'error' AND 'close' may BOTH fire — release the gate slot exactly once.
    let slotReleased = false;
    const releaseSlotOnce = () => {
      if (slotReleased) return;
      slotReleased = true;
      releaseStreamSlot();
    };

    // No byte may be sent to the client until the entire payload has been
    // produced and verified. Streaming partial output was the source of the
    // 0-byte/truncated "audio/mpeg" responses: once headers were committed,
    // a mid-stream yt-dlp failure could no longer be reported as an error.
    const startupTimeout = setTimeout(() => {
      if (!settled && !killed) {
        killYtProcess(yt);
        settle(() => retryOrFail(504, "DOWNLOAD_TIMEOUT", "Download timed out after retries", { videoId, attempts: maxAttempts }));
      }
    }, 60000);

    // Retry the whole attempt or fail the response once retries are spent.
    // Never touches a response that already ended/destroyed.
    const retryOrFail = (status, code, message, details) => {
      if (attempt < maxAttempts) {
        attempt++;
        console.log("[Download] Retrying... attempt", attempt, "for:", videoId);
        setTimeout(async () => {
          await refreshProxyBeforeRetry();
          attemptDownload();
        }, retryDelayMs(attempt));
      } else if (!res.headersSent && !res.destroyed) {
        fail(res, status, code, message, details);
      } else {
        res.destroy();
      }
    };

    // Exactly-once settlement for this attempt. A failed spawn fires BOTH
    // 'error' and 'close'; only the first settle may act (or schedule the
    // retry), the second is a no-op.
    const settle = (fn) => {
      if (settled || killed) return;
      settled = true;
      attemptInFlight = false;
      clearTimeout(startupTimeout);
      fn();
    };

    // Hard cap so a runaway producer can never exhaust server memory.
    // A typical song is 3-10MB; 64MB covers even a 20-minute high-bitrate
    // track. 3 parallel downloads at the old 128MB cap = 384MB — an OOM on
    // the free tier. Bounded here keeps the heap safe.
    const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

    yt.stdout.on("data", (chunk) => {
      if (settled) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BUFFER_BYTES) {
        console.error("[Download] BUFFER_LIMIT_EXCEEDED", { videoId, bytes: totalBytes });
        killYtProcess(yt);
        settle(() => retryOrFail(500, "DOWNLOAD_TOO_LARGE", "Download exceeded the size limit", { videoId, bytes: totalBytes }));
        return;
      }
      buffer.push(chunk);
    });

    yt.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.error("[Download] YT_DLP_STDERR", { videoId, attempt, msg });
      stderrOutput += msg + "\n";
    });

    yt.on("error", (err) => {
      releaseSlotOnce();
      console.error("[Download] YT_DLP_PROCESS_ERROR", { videoId, attempt, error: err.message });
      settle(() => retryOrFail(500, "DOWNLOAD_ERROR", "Download process failed after retries", { videoId, detail: err.message, attempts: maxAttempts }));
    });

    yt.on("close", (code) => {
      releaseSlotOnce();
      settle(() => {
        console.log("[Download] YT_DLP_CLOSE", { videoId, attempt, code, totalBytes });
        
        // Anything but a clean exit means the payload is incomplete — never
        // serve it, even when some bytes were produced.
        if (code !== 0) {
          console.error("[Download] YT_DLP_FAILED", { videoId, attempt, code, totalBytes });
          retryOrFail(500, "DOWNLOAD_FAILED", "Download failed after retries", { videoId, code, detail: stderrOutput.slice(0, 500), attempts: maxAttempts });
          return;
        }

        // Empty / too-small payloads are never valid audio.
        if (totalBytes < MIN_BYTES) {
          console.error("[Download] YT_DLP_EMPTY", { videoId, attempt, bytes: totalBytes });
          retryOrFail(500, "DOWNLOAD_EMPTY", "Download produced no audio data", { videoId, bytes: totalBytes, code, detail: stderrOutput.slice(0, 500), attempts: maxAttempts });
          return;
        }

        // Detect the real container from magic bytes — never trust a default.
        console.log("[Download] MAGIC_BYTES_CHECK", { videoId, attempt, bytes: totalBytes });
        const first = buffer[0];
        let detectedMime = null;
        let detectedExt = null;
        if (first.length >= 3 && first[0] === 0x49 && first[1] === 0x44 && first[2] === 0x33) { detectedMime = "audio/mpeg"; detectedExt = "mp3"; }
        else if (first.length >= 2 && first[0] === 0xFF && (first[1] & 0xE0) === 0xE0) { detectedMime = "audio/mpeg"; detectedExt = "mp3"; }
        else if (first.length >= 8 && first[4] === 0x66 && first[5] === 0x74 && first[6] === 0x79 && first[7] === 0x70) { detectedMime = "audio/mp4"; detectedExt = "m4a"; }
        else if (first.length >= 4 && first[0] === 0x1A && first[1] === 0x45 && first[2] === 0xDF && first[3] === 0xA3) { detectedMime = "audio/webm"; detectedExt = "webm"; }
        else if (first.length >= 4 && first[0] === 0x4F && first[1] === 0x67 && first[2] === 0x67 && first[3] === 0x53) { detectedMime = "audio/ogg"; detectedExt = "ogg"; }

        if (!detectedMime) {
          // Not audio — likely an error page or unsupported output. Never serve
          // this as audio/mpeg.
          console.error("[Download] MAGIC_BYTES_FAILED", { videoId, attempt, bytes: totalBytes });
          retryOrFail(500, "DOWNLOAD_NOT_AUDIO", "Download did not produce a supported audio file", { videoId, bytes: totalBytes, attempts: maxAttempts });
          return;
        }

        if (res.destroyed || res.writableEnded) {
          // The client disconnected while the payload was being buffered —
          // the response is gone; nothing to write or end.
          console.log("[Download] CLIENT_DISCONNECTED", { videoId, attempt, bytes: totalBytes });
          buffer.length = 0;
          return;
        }

        // Fully buffered + verified: commit the response with an exact
        // Content-Length so clients can detect any truncation on their side.
        res.setHeader("Content-Disposition", 'attachment; filename="' + safeName + '.' + detectedExt + '"');
        res.setHeader("Content-Type", detectedMime);
        res.setHeader("Content-Length", String(totalBytes));
        res.setHeader("Cache-Control", "no-cache, no-store");
        console.log("[Download] DOWNLOAD_COMPLETE", { videoId, attempt, bytes: totalBytes, mime: detectedMime, ext: detectedExt });
        for (const chunk of buffer) {
          res.write(chunk);
        }
        buffer.length = 0;
        res.end();
      });
    });

    // The incoming request can close normally before the buffered response is
    // committed (especially with keep-alive). Only treat a response close
    // before completion as a client disconnect; otherwise a healthy yt-dlp
    // process gets killed mid-download and the client sees a false HTTPS/
    // truncated-transfer error.
    res.on("close", () => {
      if (res.writableEnded || settled || killed) return;
      clearTimeout(startupTimeout);
      killed = true;
      attemptInFlight = false;
      killYtProcess(yt);
    });
    }, {
      queueTimeoutMs: 120_000,
      priority: PRIORITY.PLAY,
      id: `play:${videoId}`,
      onQueuedTooLong: () => {
        console.error("[Download] QUEUE_TIMEOUT:", videoId);
        if (!res.headersSent && !res.destroyed) fail(res, 503, "DOWNLOAD_BUSY", "Server is busy — try again shortly", { videoId });
      },
    });
  };

  attemptDownload();
});

// Maps googlevideo stream URLs back to their video IDs so the audio proxy can
// refresh stale/expired URLs (403/416) with a fresh yt-dlp lookup when needed.
const audioUrlVideoMap = new Map();
// videoId -> { url, at } — recently refreshed URLs, so retry storms reuse them
const freshAudioUrlCache = new Map();
const FRESH_URL_TTL_MS = 30 * 60 * 1000; // 30min — keeps pre-extracted URLs warm across a listening session

// Run yt-dlp once more to fetch a fresh direct audio URL for a video.
// Returns null on failure; caches successful results briefly.
function getFreshAudioUrl(videoId) {
  return new Promise((resolve) => {
    const cached = freshAudioUrlCache.get(videoId);
    if (cached && Date.now() - cached.at < FRESH_URL_TTL_MS) {
      return resolve(cached.url);
    }
    runYtDlp([
      "-f", "bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio/best",
      "--get-url",
      "--no-warnings",
      "--no-check-certificates",
      "--age-limit", "18",
      ...YT_EXTRACTOR_ARGS,
      ...YT_COOKIES_ARGS,
      ...YT_PROXY_ARGS,
      "https://www.youtube.com/watch?v=" + videoId
    ], { timeout: 25000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      const url = String(stdout || "").trim();
      if (!url || !url.startsWith("http")) return resolve(null);
      freshAudioUrlCache.set(videoId, { url, at: Date.now() });
      resolve(url);
    });
  });
}

// Lightweight extraction — returns short-lived googlevideo URL without piping audio.
// Used as optimistic fast path for Android native MediaPlayer; fallback is /api/stream.
// Uses the SAME proven yt-dlp invocation as /audio-info (--dump-json): --get-url
// failed 4/4 in production while --dump-json succeeded — parse formats instead.
app.get("/api/extract/:videoId", (req, res) => {
  const videoId = req.params.videoId;
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return fail(res, 400, "INVALID_VIDEO_ID", "Invalid video ID format", { videoId });
  }
  // Serve from existing freshAudioUrlCache if still fresh (10m TTL)
  const cached = freshAudioUrlCache.get(videoId);
  if (cached && Date.now() - cached.at < FRESH_URL_TTL_MS) {
    return ok(res, { url: cached.url, expires: cached.at + FRESH_URL_TTL_MS, cached: true }, "Extracted URL (cached)");
  }
  const attemptExtract = (attempt = 1) => {
    const maxAttempts = 2;
    runYtDlp([
      "-f", "bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio/best",
      "--dump-json",
      "--no-warnings",
      "--no-check-certificates",
      "--age-limit", "18",
      ...YT_EXTRACTOR_ARGS,
      ...YT_COOKIES_ARGS,
      ...YT_PROXY_ARGS,
      "https://www.youtube.com/watch?v=" + videoId
    ], { timeout: 25000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        console.error("[Extract] failed for", videoId, "attempt", attempt, err.message);
        if (attempt < maxAttempts) {
          return setTimeout(async () => {
            await refreshProxyBeforeRetry();
            attemptExtract(attempt + 1);
          }, retryDelayMs(attempt));
        }
        return fail(res, 502, "YT_DLP_ERROR", "Failed to extract URL", { videoId, detail: err.message.slice(0, 500) });
      }
      try {
        const info = JSON.parse(stdout);
        const formats = (info.formats || []).filter(f => f.acodec !== "none" && f.url && String(f.url).startsWith("http"));
        if (formats.length === 0) {
          return fail(res, 502, "NO_FORMATS", "No audio formats returned", { videoId });
        }
        formats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
        const url = formats[0].url;
        freshAudioUrlCache.set(videoId, { url, at: Date.now() });
        // Map ALL format URLs so proxy-audio can refresh on later 403
        for (const f of formats) audioUrlVideoMap.set(f.url, videoId);
        return ok(res, { url, expires: Date.now() + FRESH_URL_TTL_MS, cached: false }, "Extracted URL");
      } catch (e) {
        console.error("[Extract] parse error for", videoId, e.message);
        return fail(res, 502, "PARSE_ERROR", "Failed to parse extraction", { videoId, detail: e.message.slice(0, 300) });
      }
    }, req.headers['x-preload'] === '1' ? PRIORITY.PRELOAD : PRIORITY.PLAY);
  };
  attemptExtract();
});

// Get audio info (for preloading stream URL)
app.get("/api/audio-info/:videoId", (req, res) => {
  const videoId = req.params.videoId;
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return fail(res, 400, "INVALID_VIDEO_ID", "Invalid video ID format", { videoId });
  }
  res.setHeader("Cache-Control", "public, max-age=600, stale-while-revalidate=1200");

  console.log("[AudioInfo] Getting info for:", videoId);

  const attemptInfo = (attempt = 1) => {
    const maxAttempts = 3;
    runYtDlp([
      "-f", "bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio/best",
      "--dump-json",
      "--no-warnings",
      "--no-check-certificates",
      "--age-limit", "18",
      ...YT_EXTRACTOR_ARGS,
      ...YT_COOKIES_ARGS,
      ...YT_PROXY_ARGS,
      "https://www.youtube.com/watch?v=" + videoId
    ], { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        console.error("[AudioInfo] Error for:", videoId, "attempt", attempt, err.message);
        if (attempt < maxAttempts) {
          return setTimeout(async () => {
            await refreshProxyBeforeRetry();
            attemptInfo(attempt + 1);
          }, retryDelayMs(attempt));
        }
        return fail(res, 502, "YT_DLP_ERROR", "Failed to get audio info", { videoId, detail: err.message });
      }
      try {
        const info = JSON.parse(stdout);
        const formats = (info.formats || []).filter(f => f.acodec !== "none").map(f => ({
          url: f.url || '',
          quality: f.format_note || '',
          ext: f.ext || '',
          bitrate: f.abr || 0,
        }));
        for (const f of formats) {
          if (f.url) audioUrlVideoMap.set(f.url, videoId);
        }
        return ok(res, {
          title: String(info.title || 'Unknown'),
          artist: String(info.uploader || info.channel || 'Unknown'),
          duration: Number(info.duration) || 0,
          thumbnail: String(info.thumbnail || ''),
          formats,
        }, "Audio info retrieved");
      } catch (e) {
        console.error("[AudioInfo] Parse error for:", videoId);
        return fail(res, 500, "PARSE_ERROR", "Failed to parse audio info", { videoId, detail: e.message });
      }
    });
  };

  attemptInfo();
});

// ── WARP curl fetcher ─────────────────────────────────────────────────────
// When WARP is active, googlevideo URLs are signed to the Cloudflare exit
// IP.  A plain Node.js `fetch()` leaves from Render's own IP → 403.  We
// shell out to `curl --proxy socks5h://…` so the fetch exits through the
// same WARP tunnel that extracted the URL.
function pipeViaWarpCurl(url, clientRange, res, req) {
  const tmpFile = "/tmp/ytproxy_" + process.pid + "_" + Date.now();
  const curlArgs = [
    "--proxy", "socks5h://127.0.0.1:1080",
    "-s", "-S",
    "-L",
    "-D", tmpFile,
    "--max-time", "30",
    "--connect-timeout", "10",
    "-H", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "-H", "Origin:https://www.youtube.com",
    "-H", "Referer:https://www.youtube.com/",
  ];
  if (clientRange) curlArgs.push("-H", "Range:" + clientRange);
  curlArgs.push(url);

  console.log("[ProxyAudio/WARP] curl fetch via SOCKS5 for:", url.substring(0, 80));
  const child = spawn("curl", curlArgs, { stdio: ["ignore", "pipe", "pipe"] });

  const cleanup = () => { try { child.kill(); } catch {} };
  req.once("close", cleanup);

  let headersParsed = false;
  let httpStatus = 0;
  let detectedContentType = "audio/mpeg";
  let totalBytes = 0;

  // Read stderr for errors
  let stderrBuf = "";
  child.stderr.on("data", (d) => { stderrBuf += d.toString(); });

  // Once headers file is written (by curl -D), parse it and decide.
  // curl -L appends headers from each redirect, so we take the LAST
  // HTTP status line + its headers (googlevideo returns 302 → final 200).
  const tryParseHeaders = () => {
    if (headersParsed) return;
    try {
      if (!fs.existsSync(tmpFile)) return;
      const raw = fs.readFileSync(tmpFile, "utf8");
      if (!raw.includes("HTTP/")) return; // incomplete
      // Split into response blocks separated by blank lines
      const blocks = raw.split(/\r?\n\r?\n/);
      // Take the last block that starts with HTTP/
      for (let i = blocks.length - 1; i >= 0; i--) {
        const lines = blocks[i].split("\r?\n");
        const statusMatch = lines[0].match(/^HTTP\/[\d.]+\s+(\d+)/);
        if (statusMatch) {
          headersParsed = true;
          httpStatus = parseInt(statusMatch[1], 10);
          for (const line of lines.slice(1)) {
            const colonIdx = line.indexOf(":");
            if (colonIdx < 0) continue;
            const key = line.substring(0, colonIdx).trim().toLowerCase();
            const val = line.substring(colonIdx + 1).trim();
            if (key === "content-type") detectedContentType = val;
          }
          break;
        }
      }
      if (headersParsed) console.log("[ProxyAudio/WARP] HTTP", httpStatus, detectedContentType);
    } catch {}
  };

  child.stdout.on("data", (chunk) => {
    if (!headersParsed) {
      tryParseHeaders();
      // Set response headers before the first write.
      if (headersParsed && httpStatus >= 200 && httpStatus < 300) {
        res.setHeader("Content-Type", detectedContentType);
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Access-Control-Allow-Origin", "*");
      }
    }
    totalBytes += chunk.length;
    if (res.writable) res.write(chunk);
  });

  child.on("error", (err) => {
    req.removeListener("close", cleanup);
    try { fs.unlinkSync(tmpFile); } catch {}
    console.error("[ProxyAudio/WARP] curl error:", err.message);
    if (!res.headersSent) fail(res, 502, "WARP_CURL_ERROR", "curl process failed");
  });

  child.on("close", (code) => {
    req.removeListener("close", cleanup);
    if (!headersParsed) tryParseHeaders();
    try { fs.unlinkSync(tmpFile); } catch {}

    if (code && code !== 0 && totalBytes === 0) {
      console.error("[ProxyAudio/WARP] curl exited", code, stderrBuf.slice(0, 300));
      if (!res.headersSent) fail(res, 502, "WARP_CURL_FAILED", "curl failed via WARP");
    } else if (httpStatus >= 200 && httpStatus < 300) {
      console.log("[ProxyAudio/WARP] Streamed", totalBytes, "bytes");
      res.end();
    } else if (httpStatus >= 300 && httpStatus < 400) {
      // 3xx redirect from googlevideo — follow manually
      const location = stderrBuf.match(/[Ll]ocation:\s*(.+)/);
      console.log("[ProxyAudio/WARP] Got redirect", httpStatus, location ? location[1].substring(0, 80) : "");
      if (!res.headersSent) fail(res, 502, "WARP_REDIRECT", "Unexpected redirect from upstream");
    } else {
      console.error("[ProxyAudio/WARP] Upstream HTTP", httpStatus, "bytes:", totalBytes);
      if (!res.headersSent) fail(res, httpStatus || 502, "WARP_UPSTREAM_ERROR", "Upstream returned error via WARP");
    }
  });
}

// ── Audio Proxy ──────────────────────────────────────────────────────────────
// Proxies audio streams from Google CDN. The audio-info endpoint returns URLs
// that are IP-locked to the WARP exit IP — a plain fetch() from Render gets 403.
// When WARP is active, googlevideo URLs are fetched through the WARP SOCKS5
// proxy using curl so the fetch exits from the same IP that extracted the URL.
//
// Failure recovery:
//   403/416 from Google usually means the stream URL expired or was rejected.
//   We refresh it via yt-dlp (reusing `freshAudioUrlCache` for retry storms)
//   and retry once. If a 416 persists, we retry without a Range header.
app.get("/api/proxy-audio", (req, res) => {
  const audioUrl = req.query.url;
  if (!audioUrl || !audioUrl.startsWith("https://")) {
    return fail(res, 400, "INVALID_URL", "Missing or invalid url parameter");
  }

  const clientRange = req.headers.range;
  const videoId = audioUrlVideoMap.get(audioUrl) || req.query.videoId || null;

  console.log("[ProxyAudio] Proxying:", audioUrl.substring(0, 100), videoId ? `(videoId: ${videoId})` : "");

  // Googlevideo URLs are signed to the WARP exit IP. Route through WARP
  // so the fetch exits from the same IP that extracted the URL.
  if (YT_PROXY_ARGS.length > 0 && audioUrl.includes("googlevideo.com")) {
    return pipeViaWarpCurl(audioUrl, clientRange, res, req);
  }

  const pipeToClient = async (url, options = {}) => {
    const { refreshed = false, includeRange = true } = options;
    const controller = new AbortController();

    // IDLE timeout, not total-time: a download legitimately takes minutes on
    // slow connections. A hard 30s cap used to abort the upstream fetch
    // mid-transfer and res.end() made the client see a clean-but-truncated
    // stream — the root cause of partial/0-byte downloads over the proxy.
    const IDLE_TIMEOUT_MS = 30000;
    let idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    };

    const cleanup = () => {
      clearTimeout(idleTimer);
      controller.abort();
    };
    req.once("close", cleanup);

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Origin": "https://www.youtube.com",
      "Referer": "https://www.youtube.com/",
    };
    if (includeRange) headers["Range"] = clientRange || "bytes=0-";

    try {
      const upstream = await fetch(url, { signal: controller.signal, headers });

      if (!upstream.ok) {
        // Drain/cancel the failed body so the socket can be reused
        try { await upstream.body?.cancel(); } catch {}

        if (upstream.status === 403 || upstream.status === 416 || upstream.status === 502) {
          if (!refreshed && videoId) {
            freshAudioUrlCache.delete(videoId);
            const fresh = await getFreshAudioUrl(videoId);
            if (fresh && fresh !== url) {
              console.log("[ProxyAudio] Refreshing stale URL for", videoId, "after HTTP", upstream.status);
              return pipeToClient(fresh, { refreshed: true, includeRange });
            }
          }
          // Proxy and refresh both failed — fall back to inline yt-dlp stream pipe
          if (videoId) {
            console.log("[ProxyAudio] Falling back to /stream pipe for:", videoId);
            req.removeListener("close", cleanup);
            // Redirect to /api/stream which handles extraction + caching
            req.url = `/api/stream/${videoId}`;
            return app.handle(req, res);
          }
          if (upstream.status === 416 && includeRange) {
            console.log("[ProxyAudio] Retrying", videoId || "stream", "without Range after 416");
            return pipeToClient(url, { refreshed, includeRange: false });
          }
        }

        console.error("[ProxyAudio] Upstream error:", upstream.status);
        req.removeListener("close", cleanup);
        return fail(res, upstream.status, "UPSTREAM_ERROR", "Upstream returned error");
      }

      req.removeListener("close", cleanup);

      // Forward relevant headers
      const contentType = upstream.headers.get("content-type") || "audio/mpeg";
      const contentLength = upstream.headers.get("content-length");
      const contentRange = upstream.headers.get("content-range");
      const acceptRanges = upstream.headers.get("accept-ranges");

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      if (contentRange) res.setHeader("Content-Range", contentRange);
      if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);
      if (upstream.status === 206) res.status(206);

      const reader = upstream.body.getReader();
      let bytesWritten = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (res.destroyed) break;
          bytesWritten += value.length;
          resetIdle();
          if (!res.write(value)) {
            await new Promise(resolve => res.once("drain", resolve));
          }
        }
      } catch (e) {
        // Upstream died or idle-timed-out mid-stream
        console.error("[ProxyAudio] Stream interrupted:", e.message);
      } finally {
        clearTimeout(idleTimer);
        // Never end cleanly on a truncated transfer: when Content-Length was
        // declared but fewer bytes arrived, destroy the socket so the client
        // sees a network error instead of saving a partial file as complete.
        if (contentLength && bytesWritten !== Number(contentLength)) {
          console.error(`[ProxyAudio] Truncated stream (${bytesWritten}/${contentLength} bytes) — destroying response`);
          res.destroy();
        } else {
          res.end();
        }
      }
    } catch (err) {
      clearTimeout(idleTimer);
      console.error("[ProxyAudio] Fetch failed:", err.message);
      if (!res.headersSent) {
        fail(res, 502, "PROXY_FAILED", "Failed to fetch audio from upstream");
      }
    }
  };

  pipeToClient(audioUrl).catch((err) => {
    console.error("[ProxyAudio] Proxy pipeline error:", err.message);
    if (!res.headersSent) {
      fail(res, 502, "PROXY_FAILED", "Failed to proxy audio stream");
    }
  });
});

// Lyrics endpoint — returns not-implemented (no lyrics provider configured)
app.get("/api/lyrics/:videoId", (req, res) => {
  const videoId = req.params.videoId;
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return fail(res, 400, "INVALID_VIDEO_ID", "Invalid video ID format", { videoId });
  }
  return fail(res, 501, "NOT_IMPLEMENTED", "Lyrics provider not configured", { videoId });
});

// ---------------------------------------------------------------------------
// JioSaavn api.php passthrough
// ---------------------------------------------------------------------------
// JioSaavn's public api.php sends no CORS headers, so browsers and Capacitor
// WebViews cannot call it directly. This tiny whitelist forwards the read-only
// operations the JioSaavn provider needs (`search.getResults`,
// `song.getDetails`) and re-emits JSON. The upstream query is rebuilt
// server-side — user input never reaches JioSaavn as a raw query string.
const JIOSAAVN_UPSTREAM = "https://www.jiosaavn.com/api.php";
const JIOSAAVN_CALLS = {
  "search.getResults": "4",
  "song.getDetails": "2",
};
const JIOSAAVN_ALLOWED_PARAMS = new Set(["q", "pids", "page", "n"]);
app.get("/api/jiosaavn", async (req, res) => {
  const call = req.query.__call;
  if (typeof call !== "string" || !Object.prototype.hasOwnProperty.call(JIOSAAVN_CALLS, call)) {
    return fail(res, 400, "INVALID_CALL", "Unsupported JioSaavn operation", { call });
  }
  try {
    const upstream = new URL(JIOSAAVN_UPSTREAM);
    upstream.searchParams.set("__call", call);
    upstream.searchParams.set("api_version", JIOSAAVN_CALLS[call]);
    upstream.searchParams.set("_format", "json");
    for (const [key, value] of Object.entries(req.query)) {
      if (JIOSAAVN_ALLOWED_PARAMS.has(key)) {
        upstream.searchParams.set(key, Array.isArray(value) ? String(value[0]) : String(value));
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const upstreamRes = await fetch(upstream, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
    });
    clearTimeout(timer);
    const text = await upstreamRes.text();
    res.status(upstreamRes.status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=120");
    res.send(text);
  } catch (upstreamErr) {
    console.error("[Server] JioSaavn upstream failed:", upstreamErr && upstreamErr.message ? upstreamErr.message : upstreamErr);
    return fail(res, 502, "UPSTREAM_ERROR", "JioSaavn upstream request failed");
  }
});

// API root
app.get("/api", (req, res) => {
  return ok(res, { songs: songs.length, version: "1.2.0", endpoints: ["/api/songs", "/api/search", "/api/genre/:genre", "/api/youtube/search", "/api/youtube/trending", "/api/charts/trending.json", "/api/stream/:videoId", "/api/download/:videoId", "/api/audio-info/:videoId", "/api/lyrics/:videoId", "/api/playlists", "/api/playlists/:id/songs", "/api/health"] }, "API ready");
});

// Catch-all 404 — always return JSON, never HTML
app.use((req, res) => {
  if (!res.headersSent) {
    return fail(res, 404, "NOT_FOUND", "Endpoint not found", { path: req.originalUrl, method: req.method });
  }
});

// Global error handler — always return JSON, never HTML
app.use((err, _req, res, _next) => {
  console.error("[Server] Unhandled error:", err.message || err);
  if (!res.headersSent) {
    return fail(res, 500, "INTERNAL_ERROR", "Internal server error", { detail: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log("[Server] " + songs.length + " songs on http://localhost:" + PORT);
  console.log("[Server] Starting background trending fetch...");
  doFetchTrending()
    .then(result => {
      trendingCache = result.results.slice(0, 40);
      trendingCacheTime = Date.now();
      trendingSource = result.source;
      console.log("[Server] Startup trending:", result.source, "-", trendingCache.length, "songs");
    })
    .catch(err => {
      console.error("[Server] Startup trending fetch failed:", err.message);
    });
  autoScrapeTrending().catch((err) => {
    console.error("[Auto-Scrape] Fatal error:", err.message || err);
  });
});

async function autoScrapeTrending() {
try {
  const https = require("https");
  const http = require("http");
  const QUERIES = [
    "trending songs 2025", "top hits 2025", "viral songs 2025",
    "trending Bollywood 2025", "trending K-pop 2025", "trending Latin 2025",
    "new music 2025", "most popular songs now", "trending TikTok music 2025",
    "new pop songs 2025", "latest Hindi hits", "Arijit Singh new 2025",
    "Taylor Swift new 2025", "Bad Bunny new 2025", "BLACKPINK new 2025",
    "Ed Sheeran new 2025", "Diljit Dosanjh new 2025", "Sabrina Carpenter trending",
    "Dua Lipa trending", "Post Malone trending", "Kendrick Lamar trending",
    "Billie Eilish trending", "Olivia Rodrigo trending", "Lady Gaga trending",
  ];
  function fetchPage(url) {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith("https") ? https : http;
      const req = mod.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" }, timeout: 8000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return fetchPage(res.headers.location).then(resolve).catch(reject);
        let data = ""; res.on("data", chunk => data += chunk); res.on("end", () => resolve(data));
      });
      req.on("error", reject); req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    });
  }
  function extractIds(html) { const ids = []; const re = /"videoId":"([A-Za-z0-9_-]{11})"/g; let m; while ((m = re.exec(html)) !== null) ids.push(m[1]); return [...new Set(ids)]; }
  async function getTitle(id) { try { const html = await fetchPage("https://www.youtube.com/watch?v=" + id); const m = html.match(/<title>(.*?)<\/title>/); if (m) return m[1].replace(/ - YouTube$/, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\|/g, "-").trim(); } catch (e) { console.error("[Auto-Scrape] Failed to get title for:", id, e.message); } return null; }
  function parseTitle(t) { if (!t) return null; let c = t.replace(/\(Official( Music)? Video\)/gi, "").replace(/\[Official( Music)? Video\]/gi, "").replace(/\(Lyrics\)/gi, "").replace(/\[Lyrics\]/gi, "").replace(/\(Audio\)/gi, "").replace(/\(Official Audio\)/gi, "").replace(/\(VEVO\)/gi, "").replace(/\(4K\)/gi, "").replace(/\(HD\)/gi, "").trim(); const p = c.split(" - "); if (p.length >= 2) return { artist: p[0].trim(), title: p.slice(1).join(" - ").trim() }; return { artist: "Unknown", title: c }; }
  function guessGenre(t, a) { const x = (t + " " + a).toLowerCase(); if (/arijit|shreya|atif|udit|sonu nigam|kishore|lata|rahat|kumar sanu|alka|KK|shaan|sunidhi|sukhwinder|sachin|vishal|pritam|ankit|mithoon|tanishk|bpraak|guru randhawa|diljit|badshah|ap dhillon|karan aujla|raabta|tum hi ho|kabira|kuch kuch|suraj hua|pehla nasha|zara zara|aankhein|tip tip|maula|chura liya|mere sapno|dil cheez|roja|shukran|tere liye|albela|koi mil|tumhi dekho|maahi ve|dekha toh/.test(x)) return "Indian"; if (/kpop|bts|blackpink|aespa|twice|ive|newjeans|stray kids|ateez|lesserafim|seventeen|jennie|lisa|rosé|jimin|jungkook|j-hope|jin /.test(x)) return "K-Pop"; if (/bad bunny|j balvin|karol g|shakira|maluma|rauw|daddy yankee|feid|ozuna|becky g|fuerza|natanael|peso pluma/.test(x)) return "Latin"; if (/burna boy|wizkid|davido|rema|fireboy|ayra|tems|asake|omah|ckay|black sherif|shenseea/.test(x)) return "Afrobeats"; if (/rap|hip hop|drake|kendrick|travis scott|post malone|cardi b|meg|future|21 savage|lil|gunna|kanye|eminem|nicki|jack harlow|baby keem|sZA|summer walker|brent faiyaz|6lack|snoh/.test(x)) return "Hip Hop"; if (/rock|metal|linkin|imagine dragons|maroon 5|coldplay|queen|bon jovi|killers|foo fighters|ac dc|led zeppelin|beatles|pink floyd/.test(x)) return "Rock"; if (/electro|edm|alan walker|marshmello|calvin harris|david guetta|martin garrix|tiesto|skrillex|zedd|kygo/.test(x)) return "Electronic"; if (/indie|hozier|lana del|glass animals|clairo|beabadoobee|laufey|still woozy|benson boone|gigi perez|sam fender/.test(x)) return "Indie"; if (/r&b|soul|the weeknd|sza|frank ocean|anderson .paak|silk sonic|bruno mars|teddy swims|leon thomas/.test(x)) return "R&B"; if (/country|morgan wallen|luke combs|blake shelton|carrie|kacey|chris stapleton|jelly roll|zach bryan|noah kahan/.test(x)) return "Country"; return "Pop"; }
  let addedCount = 0;
  const existingIds = new Set(songs.map(s => s.youtubeId));
  for (let i = 0; i < QUERIES.length; i++) {
    try {
      const html = await fetchPage("https://www.youtube.com/results?search_query=" + encodeURIComponent(QUERIES[i]));
      const ids = extractIds(html);
      for (const id of ids.slice(0, 5)) {
        if (existingIds.has(id)) continue;
        const title = await getTitle(id); if (!title) continue;
        const parsed = parseTitle(title); if (!parsed || parsed.title.length < 2 || parsed.artist === "Unknown") continue;
        const genre = guessGenre(parsed.title, parsed.artist);
        existingIds.add(id);
        songs.push({ id: "yt-" + songs.length, youtubeId: id, title: parsed.title, artist: parsed.artist, genre, duration: 180 + Math.floor(Math.random() * 120), coverArt: "https://img.youtube.com/vi/" + id + "/mqdefault.jpg" });
        addedCount++;
      }
      if (i % 10 === 0) console.log("[Auto-Scrape] " + (i + 1) + "/" + QUERIES.length + " queries, added " + addedCount + " new songs");
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error("[Auto-Scrape] Failed query:", QUERIES[i], e.message);
    }
  }
  if (addedCount > 0) console.log("[Auto-Scrape] Done! Added " + addedCount + " trending songs. Total: " + songs.length);
} catch (err) {
  console.error("[Auto-Scrape] Error:", err.message || err);
}
}
