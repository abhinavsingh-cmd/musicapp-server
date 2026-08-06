import { Song } from '../types/music';
import { useSongsStore } from '../stores/songsStore';

// ---- Public types ----

export interface IndexedSearchHit {
  song: Song;
  score: number;
}

export interface SearchOptions {
  limit?: number;
  shouldCancel?: () => boolean;
}

// ---- Normalization / tokenization ----

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const TOKEN_RE = /[a-z0-9]+/g;

function tokenize(s: string): string[] {
  const tokens = normalize(s).match(TOKEN_RE);
  return tokens || [];
}

function bigramsOf(tok: string): string[] {
  if (tok.length < 2) return [tok];
  const out: string[] = [];
  for (let i = 0; i + 1 < tok.length; i++) out.push(tok.slice(i, i + 2));
  return out;
}

function levenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const cols = b.length + 1;
  let prev = new Array<number>(cols).fill(0).map((_, j) => j);
  let curr = new Array<number>(cols);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

// ---- Index snapshot ----

interface TokenRecord {
  token: string;
  id: number;
}

interface Posting {
  songIdx: number;
  weight: number;
}

interface SongRecord {
  song: Song;
  title: string;
  artist: string;
  album: string;
  genre: string;
}

interface Snapshot {
  tokenId: Map<string, number>;
  tokenById: Map<number, string>;
  tokens: TokenRecord[];
  postings: Map<number, Posting[]>;
  bigrams: Map<string, number[]>;
}

function emptySnapshot(): Snapshot {
  return { tokenId: new Map(), tokenById: new Map(), tokens: [], postings: new Map(), bigrams: new Map() };
}

function fieldsOf(song: Song): Pick<SongRecord, 'title' | 'artist' | 'album' | 'genre'> {
  return {
    title: normalize(song.title || ''),
    artist: normalize(song.artist || ''),
    album: normalize(song.album || ''),
    genre: normalize(song.genre || ''),
  };
}

// --- Background-indexed, prefix + fuzzy search index over the library. ---

const FIELD_WEIGHTS: Array<[keyof Omit<SongRecord, 'song'>, number]> = [
  ['title', 3],
  ['artist', 2],
  ['album', 1],
  ['genre', 0.75],
];

const EXACT_TOKEN_SCORE = 6;
const PREFIX_TOKEN_SCORE = 4;
const CACHE_LIMIT = 50;

function idle(cb: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => cb(), { timeout: 2000 });
  } else {
    setTimeout(cb, 0);
  }
}

export class LibrarySearchIndex {
  private songs: SongRecord[] = [];
  private lastSongsRef: Song[] | null = null;
  private pendingSongs: Song[] | null = null;
  private active: Snapshot = emptySnapshot();
  private activeReady = false;
  private building: Snapshot | null = null;
  private buildSongs: Song[] | null = null;
  private buildCursor = 0;
  private rebuildScheduled = false;
  private cache = new Map<string, IndexedSearchHit[]>();

  setSongs(songs: Song[]): void {
    if (songs === this.lastSongsRef) return;
    this.lastSongsRef = songs;
    this.pendingSongs = songs;
    this.scheduleRebuild();
  }

  async search(query: string, opts: SearchOptions = {}): Promise<IndexedSearchHit[]> {
    const q = normalize(query.trim());
    if (!q) return [];
    const limit = opts.limit ?? 15;

    const cached = this.cache.get(q);
    if (cached) {
      this.cache.delete(q);
      this.cache.set(q, cached);
      return cached;
    }

    // Don't block on index build — return empty and let caller fall through to
    // YouTube results. The index will be ready for the next keystroke.
    if (!this.activeReady) return [];

    const snap = this.active;
    const queryTokens = tokenize(q);
    if (queryTokens.length === 0) return [];

    const scores = new Map<number, number>();
    for (const qt of queryTokens) {
      if (opts.shouldCancel?.()) return [];
      const exactId = snap.tokenId.get(qt);
      if (exactId !== undefined) this.accumulate(snap, scores, exactId, EXACT_TOKEN_SCORE);
      for (const pid of this.prefixTokenIds(snap, qt)) {
        if (pid === exactId) continue;
        this.accumulate(snap, scores, pid, PREFIX_TOKEN_SCORE);
      }
      const fuzzy = new Map<number, number>();
      this.fuzzyCandidates(snap, qt, fuzzy);
      for (const [fid, fscore] of fuzzy) {
        if (fid === exactId) continue;
        this.accumulate(snap, scores, fid, fscore);
      }
    }
    if (opts.shouldCancel?.()) return [];

    const hits: IndexedSearchHit[] = [];
    for (const [songIdx, baseScore] of scores) {
      const rec = this.songs[songIdx];
      if (!rec) continue;
      let score = baseScore;
      if (rec.title === q) score += 100;
      else if (rec.title.startsWith(q)) score += 10;
      hits.push({ song: rec.song, score });
    }

    hits.sort((a, b) =>
      b.score - a.score ||
      (a.song.title || '').localeCompare(b.song.title || '') ||
      (b.song.playCount || 0) - (a.song.playCount || 0),
    );

    const top = hits.slice(0, limit);
    this.cache.set(q, top);
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return top;
  }

  suggest(query: string, opts: SearchOptions = {}): Promise<IndexedSearchHit[]> {
    return this.search(query, { ...opts, limit: opts.limit ?? 5 });
  }

  // ---- Internals ----

  private accumulate(snap: Snapshot, scores: Map<number, number>, tokenId: number, base: number): void {
    const postings = snap.postings.get(tokenId);
    if (!postings) return;
    for (const p of postings) {
      scores.set(p.songIdx, (scores.get(p.songIdx) || 0) + base * p.weight);
    }
  }

  private prefixTokenIds(snap: Snapshot, prefix: string): number[] {
    const out: number[] = [];
    const t = snap.tokens;
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid].token < prefix) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < t.length; i++) {
      if (!t[i].token.startsWith(prefix) || t[i].token === prefix) {
        if (t[i].token === prefix) continue;
        break;
      }
      out.push(t[i].id);
    }
    return out;
  }

  private fuzzyCandidates(snap: Snapshot, token: string, out: Map<number, number>): void {
    if (token.length < 3) return;
    const grams = bigramsOf(token);
    const counts = new Map<number, number>();
    for (const g of grams) {
      const ids = snap.bigrams.get(g);
      if (!ids) continue;
      for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    }
    const maxDist = token.length <= 4 ? 1 : 2;
    for (const [id, shared] of counts) {
      const tok = snap.tokenById.get(id);
      if (!tok) continue;
      if (tok === token) continue;
      if (Math.abs(tok.length - token.length) > maxDist) continue;
      const jac = shared / grams.length;
      const dist = levenshtein(token, tok, maxDist);
      if (dist <= maxDist) {
        out.set(id, (1 - dist / token.length) * 3 + jac * 2);
      } else if (jac >= 1) {
        out.set(id, 2.5);
      }
    }
  }

  private scheduleRebuild(): void {
    if (this.rebuildScheduled) return;
    this.rebuildScheduled = true;
    idle(() => this.rebuildSlice());
  }

  private rebuildSlice(): void {
    this.rebuildScheduled = false;
    const pending = this.pendingSongs;
    if (!pending) return;

    if (this.buildSongs !== pending) {
      this.building = emptySnapshot();
      this.buildSongs = pending;
      this.buildCursor = 0;
    }

    const snap = this.building!;
    const start = performance.now();
    while (this.buildCursor < this.buildSongs.length) {
      const song = this.buildSongs[this.buildCursor];
      this.indexSong(snap, song, this.buildCursor);
      this.buildCursor++;
      if (performance.now() - start > 5) break;
    }

    if (this.buildCursor >= this.buildSongs.length) {
      this.finishBuild(snap);
      return;
    }
    this.scheduleRebuild();
  }

  private indexSong(snap: Snapshot, song: Song, songIdx: number): void {
    const rec: SongRecord = { song, ...fieldsOf(song) };
    this.songs[songIdx] = rec;
    const songTokenIds = new Set<number>();
    for (const [field, weight] of FIELD_WEIGHTS) {
      const text = rec[field] || '';
      for (const tok of tokenize(text)) {
        let id = snap.tokenId.get(tok);
        if (id === undefined) {
          id = snap.tokenId.size;
          snap.tokenId.set(tok, id);
          snap.tokenById.set(id, tok);
        }
        let postings = snap.postings.get(id);
        if (!postings) {
          postings = [];
          snap.postings.set(id, postings);
        }
        postings.push({ songIdx, weight });
        if (!songTokenIds.has(id)) {
          songTokenIds.add(id);
          for (const bigram of bigramsOf(tok)) {
            let ids = snap.bigrams.get(bigram);
            if (!ids) {
              ids = [];
              snap.bigrams.set(bigram, ids);
            }
            ids.push(id);
          }
        }
      }
    }
  }

  private finishBuild(snap: Snapshot): void {
    snap.tokens = Array.from(snap.tokenId.entries())
      .map(([token, id]) => ({ id, token }))
      .sort((a, b) => (a.token < b.token ? -1 : a.token > b.token ? 1 : 0));
    this.active = snap;
    this.building = null;
    this.buildSongs = null;
    this.cache.clear();
    this.activeReady = true;
  }

}

export const librarySearchIndex = new LibrarySearchIndex();

// ---- Keep the index in sync with the songs store (background, incremental) ----

let initialized = false;

export function initLibrarySearchIndex(): void {
  if (initialized) return;
  initialized = true;

  const current = useSongsStore.getState();
  if (current.songs.length > 0) librarySearchIndex.setSongs(current.songs);

  useSongsStore.subscribe((state, prev) => {
    if (state.songs !== prev.songs) librarySearchIndex.setSongs(state.songs);
  });
}