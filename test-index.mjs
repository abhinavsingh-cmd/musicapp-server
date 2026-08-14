import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('.') || specifier.endsWith('.ts') || specifier.endsWith('.js')) {
      return nextResolve(specifier, context);
    }
    try {
      return nextResolve(specifier + '.ts', context);
    } catch {
      return nextResolve(specifier, context);
    }
  },
});

Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true });
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.requestIdleCallback = (cb) => {
  setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 0);
  return 0;
};
globalThis.cancelIdleCallback = () => {};

const { librarySearchIndex, initLibrarySearchIndex } = await import('./src/services/librarySearchIndex.ts');
const { useSongsStore } = await import('./src/stores/songsStore.ts');

const songs = [
  { id: '1', title: 'Never Gonna Give You Up', artist: 'Rick Astley', album: 'Whenever You Need Somebody', genre: 'Pop', duration: 213, coverArt: '', audioUrl: '', youtubeId: '', releaseYear: 1987, isFavorite: false, playCount: 10 },
  { id: '2', title: 'Shape of You', artist: 'Ed Sheeran', album: 'Divide', genre: 'Pop', duration: 234, coverArt: '', audioUrl: '', youtubeId: '', releaseYear: 2017, isFavorite: false, playCount: 20 },
  { id: '3', title: 'Chaleya', artist: 'Arijit Singh', album: 'Jawan', genre: 'Bollywood', duration: 231, coverArt: '', audioUrl: '', youtubeId: '', releaseYear: 2023, isFavorite: false, playCount: 30 },
  { id: '4', title: 'Calm Down', artist: 'Rema', album: 'Rave & Roses', genre: 'Afrobeats', duration: 219, coverArt: '', audioUrl: '', youtubeId: '', releaseYear: 2022, isFavorite: false, playCount: 40 },
  { id: '5', title: 'Rock Rock', artist: 'Test Artist', album: 'Album', genre: 'Rock', duration: 200, coverArt: '', audioUrl: '', youtubeId: '', releaseYear: 2020, isFavorite: false, playCount: 50 },
];

useSongsStore.setState({ songs });
initLibrarySearchIndex();

// wait for background index build
await new Promise((r) => setTimeout(r, 300));

const assert = (name, cond) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name);
  if (!cond) process.exitCode = 1;
};

let t = performance.now();
const exact = await librarySearchIndex.search('shape of you');
console.log('  exact latency:', (performance.now() - t).toFixed(2) + 'ms');
assert('exact match returns Shape of You first', exact[0]?.song.id === '2');

t = performance.now();
const prefix = await librarySearchIndex.search('cha');
console.log('  prefix latency:', (performance.now() - t).toFixed(2) + 'ms');
assert('prefix "cha" finds Chaleya', prefix.some((h) => h.song.id === '3'));

t = performance.now();
const fuzzy = await librarySearchIndex.search('shap of you');
console.log('  fuzzy latency:', (performance.now() - t).toFixed(2) + 'ms');
assert('fuzzy "shap of you" finds Shape of You', fuzzy.some((h) => h.song.id === '2'));

const contains = await librarySearchIndex.search('ver');
assert('substring "ver" finds Never Gonna (contains via bigram)', contains.some((h) => h.song.id === '1'));

const multi = await librarySearchIndex.search('ed sheeran');
assert('multi-token "ed sheeran" finds Shape of You', multi.some((h) => h.song.id === '2'));

const rock = await librarySearchIndex.search('rock');
assert('genre "rock" matches Rock Rock', rock.some((h) => h.song.id === '5'));

const sug = await librarySearchIndex.suggest('ari');
assert('suggest "ari" returns Arijit Singh', sug.some((h) => h.song.artist === 'Arijit Singh'));

t = performance.now();
await librarySearchIndex.search('shape of you');
const cached = performance.now() - t;
console.log('  cached latency:', cached.toFixed(2) + 'ms');
assert('cached repeat query', cached < 1);

// cancel
const cancelled = await librarySearchIndex.search('rock', { shouldCancel: () => true });
assert('cancel returns []', cancelled.length === 0);

// empty
assert('empty query returns []', (await librarySearchIndex.search('  ')).length === 0);

console.log('done');
