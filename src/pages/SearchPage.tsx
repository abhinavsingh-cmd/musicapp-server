import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoBack } from '../hooks/useGoBack';
import { useShallow } from 'zustand/react/shallow';
import {
  Search, X, Play, Music, Globe, Loader2,
  SlidersHorizontal, Clock, ArrowDownAZ, TrendingUp, Sparkles,
  AlertCircle, SearchX, ArrowLeft,
} from 'lucide-react';
import { SongTable } from '../features/library/SongTable';
import { DownloadButton } from '../components/DownloadButton';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Song } from '../types/music';
import { useAudioStore } from '../stores/audioStore';
import { useDebounce } from '../hooks/useDebounce';
import { useVirtualList } from '../hooks/useVirtualList';
import {
  useSearchStore,
  selectFilteredLibrary,
  selectUniqueArtists,
  selectUniqueAlbums,
  selectUniqueGenres,
  FilterType,
  SortMode,
  DurationFilter,
  SearchStatus,
  isFailureStatus,
  YTSong,
} from '../stores/searchStore';
import { cn } from '../utils/cn';
import { useSongContextMenu } from '../components/SongContextMenu';

const FILTERS: { value: FilterType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'songs', label: 'Songs' },
  { value: 'artists', label: 'Artists' },
  { value: 'albums', label: 'Albums' },
  { value: 'playlists', label: 'Playlists' },
  { value: 'genres', label: 'Genres' },
];

const SORTS: { value: SortMode; label: string; icon: React.ReactNode }[] = [
  { value: 'relevance', label: 'Relevance', icon: <Sparkles size={12} /> },
  { value: 'newest', label: 'Newest', icon: <Clock size={12} /> },
  { value: 'popular', label: 'Popular', icon: <TrendingUp size={12} /> },
  { value: 'alpha', label: 'A–Z', icon: <ArrowDownAZ size={12} /> },
];

const DURATION_FILTERS: { value: DurationFilter; label: string }[] = [
  { value: 'any', label: 'Any length' },
  { value: 'short', label: '< 3 min' },
  { value: 'medium', label: '3–6 min' },
  { value: 'long', label: '> 6 min' },
];

const GENRES = ['Pop', 'Rock', 'Hip Hop', 'Indian', 'K-Pop', 'Latin', 'R&B', 'Electronic', 'Indie', 'Afrobeats'];

// YouTube result cards can grow unboundedly via loadMore pagination — window
// them like the library list. 80px fits the tallest card (thumb 48 + p-2 +
// title/artist/album/views lines all truncate to single lines).
const YT_ROW_HEIGHT = 80;

function safeStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const fmt = (s: number) => {
  const sec = safeNum(s);
  if (sec <= 0) return '0:00';
  return Math.floor(sec / 60) + ':' + Math.floor(sec % 60).toString().padStart(2, '0');
};

const fmtViews = (n: number) => {
  const num = safeNum(n);
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toString();
};

export const SearchPage: React.FC = memo(() => {
  const navigate = useNavigate();
  const goBack = useGoBack();
  const inputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const ytListRef = useRef<HTMLDivElement>(null);
  // The last query actually sent to the store. The effect below re-runs when
  // `showSuggestions` flips (input focus), which would otherwise re-fire an
  // identical completed search — a duplicate request. Only a query CHANGE
  // may trigger search(); retries go through the banner's Retry button.
  const lastSearchedQueryRef = useRef<string | null>(null);
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // 300ms debounce: fast enough to feel instant, slow enough that typing
  // "arijit" doesn't fire a network search for every prefix (a/ar/ari/...).
  const debouncedQuery = useDebounce(query, 300);

  // Delayed focus to let layout stabilize first (avoids Android keyboard shift)
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  const { handleContextMenu, handleLongPress, ContextMenu } = useSongContextMenu(
    (artist) => navigate(`/search?q=${encodeURIComponent(artist)}`),
    (album) => navigate(`/search?q=${encodeURIComponent(album)}`),
  );

  const filter = useSearchStore((s) => s.filter);
  const sort = useSearchStore((s) => s.sort);
  const durationFilter = useSearchStore((s) => s.durationFilter);
  const genreFilter = useSearchStore((s) => s.genreFilter);
  const status = useSearchStore((s) => s.status);
  const ytStatus = useSearchStore((s) => s.ytStatus);
  const hasMore = useSearchStore((s) => s.hasMore);
  const error = useSearchStore((s) => s.error);
  const suggestions = useSearchStore((s) => s.suggestions);
  const libraryResults = useSearchStore((s) => s.libraryResults);
  const ytResults = useSearchStore((s) => s.ytResults);
  const actions = useSearchStore(useShallow((s) => ({
    setFilter: s.setFilter,
    setSort: s.setSort,
    setDurationFilter: s.setDurationFilter,
    setGenreFilter: s.setGenreFilter,
    search: s.search,
    loadMore: s.loadMore,
    clear: s.clear,
    cancelSearch: s.cancelSearch,
  })));
  const { setFilter, setSort, setDurationFilter, setGenreFilter, search, loadMore, clear, cancelSearch } = actions;

  // Cancel any in-flight search when unmounting
  useEffect(() => () => cancelSearch(), [cancelSearch]);

  const filteredLibrary = useMemo(
    () => selectFilteredLibrary({ libraryResults, filter, sort, durationFilter, genreFilter } as any),
    [libraryResults, filter, sort, durationFilter, genreFilter],
  );
  const ytRows = useMemo(() => (ytResults || []).filter((r) => r && r.id), [ytResults]);
  const ytWin = useVirtualList(ytRows.length, YT_ROW_HEIGHT, ytListRef);
  const uniqueArtists = useMemo(() => selectUniqueArtists({ libraryResults } as any), [libraryResults]);
  const uniqueAlbums = useMemo(() => selectUniqueAlbums({ libraryResults } as any), [libraryResults]);
  const uniqueGenres = useMemo(() => selectUniqueGenres({ libraryResults } as any), [libraryResults]);

  const loadSong = useAudioStore((s) => s.loadSong);

  useEffect(() => {
    if (debouncedQuery !== lastSearchedQueryRef.current) {
      lastSearchedQueryRef.current = debouncedQuery;
      search(debouncedQuery);
    }
    if (debouncedQuery && !showSuggestions) {
      setShowSuggestions(true);
    }
  }, [debouncedQuery, search, showSuggestions]);

  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;
    // Auto-page ONLY from a settled success/empty state. Re-firing loadMore
    // from a failure state (error/timeout/network/offline) re-enters the
    // loading state every time the observer re-fires while the sentinel is
    // visible — with the backend down that loops the "Searching YouTube..."
    // spinner forever. A failed page stays failed until the user retries
    // (the failure banner's Retry re-runs search()).
    const canAutoPage = ytStatus === 'success' || ytStatus === 'empty';
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && canAutoPage && hasMore) loadMore(); },
      { rootMargin: '200px' },
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [ytStatus, hasMore, loadMore, ytResults.length]);

  const handlePlayYT = useCallback((r: YTSong) => {
    if (!r || !r.id) return;
    const songs: Song[] = (ytResults || [])
      .filter((item) => item && item.id)
      .map((item) => ({
        id: 'yt-' + item.id,
        youtubeId: item.id,
        title: safeStr(item.title, 'Unknown'),
        artist: safeStr(item.artist, 'Unknown'),
        genre: 'YouTube',
        duration: safeNum(item.duration),
        coverArt: safeStr(item.thumbnail),
        album: safeStr(item.album),
        audioUrl: '',
        releaseYear: 0,
      }));
    if (songs.length === 0) return;
    const idx = songs.findIndex((s) => s.youtubeId === r.id);
    const safeIdx = idx >= 0 ? idx : 0;
    if (!songs[safeIdx]) return;
    loadSong(songs[safeIdx], songs, safeIdx);
  }, [loadSong, ytResults]);

  const handleSuggestionClick = useCallback((song: Song) => {
    if (!song || !song.title) return;
    setQuery(song.title);
    setShowSuggestions(false);
  }, []);

  const hasResults = filteredLibrary.length > 0 || ytResults.length > 0;
  const isIdle = !query && status === 'idle';
  // Never show "no results" when a backend actually FAILED — that's a
  // different state with its own banner/retry, not an empty result set.
  const isNoResults =
    query &&
    status !== 'loading' && status !== 'retrying' &&
    ytStatus !== 'loading' && ytStatus !== 'retrying' &&
    !isFailureStatus(status) && !isFailureStatus(ytStatus) &&
    !hasResults;

  // The YouTube section renders only when it has something to say: an
  // explicit loading/retrying spinner, results, or a YouTube-only failure
  // (the library half succeeded and carries the page).
  const showYtSection = !!query && (
    ytStatus === 'loading' || ytStatus === 'retrying' ||
    ytResults.length > 0 ||
    // Explicit "no YouTube results" state: the library half succeeded but
    // YouTube answered with zero rows — that is a real outcome, not an
    // error and not a hidden section.
    (ytStatus === 'empty' && status === 'success') ||
    (isFailureStatus(ytStatus) && status === 'success')
  );

  const ytFailureMessage = (s: SearchStatus, err: string | null): string => {
    switch (s) {
      case 'timeout': return 'YouTube search timed out. Try again.';
      case 'network': return 'Could not reach YouTube — network error.';
      case 'offline': return 'You are offline — YouTube search is unavailable.';
      case 'rateLimited': return 'YouTube search rate limited. Please try again shortly.';
      case 'error': return err || 'YouTube search failed (server error). Try again.';
      default: return err || 'YouTube search failed.';
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-2">
        <button onClick={goBack} className="p-2 rounded-xl hover:bg-white/5 transition-colors text-gray-400 hover:text-white flex-shrink-0" aria-label="Go back">
          <ArrowLeft size={20} />
        </button>
        <div className="relative max-w-xl flex-1">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={20} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          placeholder="Search songs, artists, albums..."
          className="w-full pl-12 pr-20 py-3 rounded-2xl bg-[#1a1a2e] border border-white/5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {query && (
            <button onClick={() => { setQuery(''); clear(); inputRef.current?.focus(); }} className="p-1.5 text-gray-500 hover:text-white transition-colors">
              <X size={16} />
            </button>
          )}
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn("p-1.5 rounded-lg transition-all", showFilters ? "text-violet-400 bg-violet-500/15" : "text-gray-500 hover:text-white")}
            title="Filters"
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>
        </div>
      </div>

      {query && showSuggestions && suggestions.length > 0 && status !== 'loading' && (
        <div className="max-w-xl relative z-20">
          <div className="rounded-2xl bg-[#1a1a2e] border border-white/5 overflow-hidden shadow-xl">
            {suggestions.slice(0, 5).map((s) => (
              <button
                key={s.id || s.title}
                onClick={() => handleSuggestionClick(s)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
              >
                <Search size={14} className="text-gray-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-white truncate">{safeStr(s.title, 'Unknown')}</span>
                  <span className="text-xs text-gray-500 ml-2">&middot; {safeStr(s.artist, 'Unknown')}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {showFilters && (
        <div className="space-y-3 max-w-xl">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-semibold transition-all border",
                  filter === f.value
                    ? "bg-violet-500/20 text-violet-300 border-violet-500/30"
                    : "bg-white/5 text-gray-400 border-white/5 hover:text-white hover:border-white/10",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Sort</span>
            <div className="flex gap-1">
              {SORTS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSort(s.value)}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all",
                    sort === s.value ? "bg-white/10 text-white" : "text-gray-500 hover:text-gray-300",
                  )}
                >
                  {s.icon}{s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Duration</span>
            <div className="flex gap-1">
              {DURATION_FILTERS.map((d) => (
                <button
                  key={d.value}
                  onClick={() => setDurationFilter(d.value)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-medium transition-all",
                    durationFilter === d.value ? "bg-white/10 text-white" : "text-gray-500 hover:text-gray-300",
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {filter === 'genres' && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setGenreFilter('')}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-medium transition-all",
                  !genreFilter ? "bg-violet-500/20 text-violet-300" : "text-gray-500 hover:text-gray-300",
                )}
              >
                All Genres
              </button>
              {uniqueGenres.map((g) => (
                <button
                  key={g}
                  onClick={() => setGenreFilter(g)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-medium transition-all",
                    genreFilter === g ? "bg-violet-500/20 text-violet-300" : "text-gray-500 hover:text-gray-300",
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isIdle && (
        <div>
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Music size={20} className="text-violet-400" />Browse by Genre
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {GENRES.map((genre) => (
              <button
                key={genre}
                onClick={() => setQuery(genre)}
                className="p-4 rounded-xl claymorphism text-white font-medium hover:scale-105 active:scale-95 transition-transform text-sm"
              >
                {genre}
              </button>
            ))}
          </div>
        </div>
      )}

      {status === 'offline' && (
        <div className="flex items-center gap-3 text-amber-400 py-4 px-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <AlertCircle size={18} />
          <span className="text-sm">You are offline. Check your connection.</span>
          <button onClick={() => search(query)} className="ml-auto text-xs text-amber-300 hover:text-white underline">
            Retry
          </button>
        </div>
      )}

      {status === 'network' && error && (
        <div className="flex items-center gap-3 text-red-400 py-4 px-4 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertCircle size={18} />
          <span className="text-sm">{error}</span>
          <button onClick={() => search(query)} className="ml-auto text-xs text-red-300 hover:text-white underline">
            Retry
          </button>
        </div>
      )}

      {status === 'timeout' && error && (
        <div className="flex items-center gap-3 text-red-400 py-4 px-4 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertCircle size={18} />
          <span className="text-sm">{error}</span>
          <button onClick={() => search(query)} className="ml-auto text-xs text-red-300 hover:text-white underline">
            Retry
          </button>
        </div>
      )}

      {status === 'rateLimited' && error && (
        <div className="flex items-center gap-3 text-amber-400 py-4 px-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <AlertCircle size={18} />
          <span className="text-sm">{error}</span>
          <button onClick={() => search(query)} className="ml-auto text-xs text-amber-300 hover:text-white underline">
            Retry
          </button>
        </div>
      )}

      {status === 'error' && error && (
        <div className="flex items-center gap-3 text-red-400 py-4 px-4 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertCircle size={18} />
          <span className="text-sm">{error}</span>
          <button onClick={() => search(query)} className="ml-auto text-xs text-red-300 hover:text-white underline">
            Retry
          </button>
        </div>
      )}

      {status === 'loading' && (
        <div className="flex items-center gap-3 text-gray-400 py-8">
          <Loader2 size={20} className="animate-spin text-violet-400" />
          Searching your library...
        </div>
      )}

      {status !== 'loading' && filteredLibrary.length > 0 && (
        <ErrorBoundary level="section" onReset={() => search(query)}>
        <div>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Music size={14} />Your Library ({filteredLibrary.length})
          </h3>

          {filter === 'artists' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-4">
              {uniqueArtists.map((artist) => (
                <button
                  key={artist}
                  onClick={() => setFilter('songs')}
                  className="p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-all text-center group"
                >
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 mx-auto mb-2 flex items-center justify-center text-white font-bold text-lg">
                    {(artist || '?')[0]}
                  </div>
                  <span className="text-sm font-medium text-white truncate block">{artist || 'Unknown'}</span>
                </button>
              ))}
            </div>
          )}

          {filter === 'albums' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-4">
              {uniqueAlbums.map((album) => {
                const song = libraryResults.find((s) => s.album === album);
                return (
                  <button
                    key={album}
                    onClick={() => setFilter('songs')}
                    className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all text-center group"
                  >
                    <div className="w-full aspect-square rounded-lg overflow-hidden bg-white/5 mb-2">
                      {song?.coverArt && <img src={song.coverArt} alt={album} className="w-full h-full object-cover" loading="lazy" />}
                    </div>
                    <span className="text-sm font-medium text-white truncate block">{album || 'Unknown'}</span>
                  </button>
                );
              })}
            </div>
          )}

          {filter !== 'artists' && filter !== 'albums' && (
            <div className="claymorphism rounded-2xl p-1">
              <SongTable songs={filteredLibrary} />
            </div>
          )}
        </div>
        </ErrorBoundary>
      )}

      {showYtSection && (
        <ErrorBoundary level="section" onReset={() => search(query)}>
        <div>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Globe size={14} className="text-red-400" />YouTube {ytResults.length > 0 ? `(${ytResults.length})` : ''}
          </h3>

          {(ytStatus === 'loading' || ytStatus === 'retrying') && ytResults.length === 0 && (
            <div className="flex items-center gap-3 text-gray-400 py-6">
              <Loader2 size={20} className="animate-spin text-violet-400" />
              {ytStatus === 'retrying' ? 'Retrying...' : 'Searching YouTube...'}
            </div>
          )}

          {ytStatus === 'empty' && status === 'success' && ytResults.length === 0 && (
            <div className="text-center py-6">
              <SearchX size={28} className="mx-auto text-gray-600 mb-2" />
              <p className="text-gray-500 text-sm">No YouTube results found</p>
              <p className="text-gray-600 text-xs mt-1">Try a different search term</p>
            </div>
          )}

          {ytRows.length > 0 && (
            <div>
              <div ref={ytListRef} style={{ position: 'relative', height: ytWin.totalHeight }}>
              {ytRows.slice(ytWin.start, ytWin.end).map((r, i) => {
                const index = ytWin.start + i;
                const ytSong: Song = {
                  id: 'yt-' + r.id, title: safeStr(r.title, 'Unknown'), artist: safeStr(r.artist, 'Unknown'),
                  album: safeStr(r.album, ''), duration: r.duration || 0, genre: 'YouTube',
                  coverArt: r.thumbnail || '', audioUrl: '', youtubeId: r.id,
                  releaseYear: 0, isFavorite: false, playCount: 0,
                };
                return (
                <div key={r.id} onClick={() => handlePlayYT(r)}
                  onContextMenu={(e) => handleContextMenu(e, ytSong)}
                  onTouchStart={(e) => handleLongPress(e, ytSong)}
                  className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors group cursor-pointer"
                  style={{ position: 'absolute', top: index * YT_ROW_HEIGHT, left: 0, right: 0, height: YT_ROW_HEIGHT }}>
                  <div className="relative w-16 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-[#1a1a2e]">
                    {r.thumbnail ? (
                      <img src={r.thumbnail} alt={r.title || ''} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Music size={16} className="text-gray-600" /></div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play size={16} fill="white" className="text-white" />
                    </div>
                    <span className="absolute bottom-0.5 right-0.5 px-1 py-0.5 bg-black/70 rounded text-[9px] text-white font-medium">
                      {fmt(r.duration)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{safeStr(r.title, 'Unknown')}</div>
                    <div className="text-xs text-gray-400 truncate">{safeStr(r.artist, 'Unknown')}</div>
                    {r.album && <div className="text-[10px] text-gray-500 truncate">{safeStr(r.album)}</div>}
                    {r.viewCount > 0 && <div className="text-[10px] text-gray-500">{fmtViews(r.viewCount)} views</div>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={(e) => { e.stopPropagation(); handlePlayYT(r); }} className="p-2 rounded-lg bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors">
                      <Play size={14} fill="currentColor" />
                    </button>
                    {/* Shared download action — always visible, never hover-gated */}
                    <DownloadButton song={ytSong} className="p-2 rounded-lg bg-white/5" />
                  </div>
                </div>
                );
              })}
              </div>

              <div ref={sentinelRef} className="h-4" />
              {(ytStatus === 'loading' || ytStatus === 'retrying') && (
                <div className="flex justify-center py-4">
                  <Loader2 size={20} className="animate-spin text-violet-400" />
                </div>
              )}
            </div>
          )}

{/* YouTube-only failure: library results stay visible; the dead
              YouTube backend is surfaced explicitly instead of masquerading
              as "no results". */}
            {(ytStatus === 'error' || ytStatus === 'network' || ytStatus === 'timeout' || ytStatus === 'offline') && status === 'success' && (
              <div className="flex items-center gap-3 text-red-400 py-3 px-4 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertCircle size={18} />
                <span className="text-sm">{ytFailureMessage(ytStatus, error)}</span>
                <button onClick={() => search(query)} className="ml-auto text-xs text-red-300 hover:text-white underline">
                  Retry
                </button>
              </div>
            )}
            {ytStatus === 'rateLimited' && status === 'success' && (
              <div className="flex items-center gap-3 text-amber-400 py-3 px-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <AlertCircle size={18} />
                <span className="text-sm">{ytFailureMessage(ytStatus, error)}</span>
                <button onClick={() => search(query)} className="ml-auto text-xs text-amber-300 hover:text-white underline">
                  Retry
                </button>
              </div>
            )}
        </div>
        </ErrorBoundary>
      )}

      {isNoResults && (
        <div className="text-center py-16">
          <SearchX size={48} className="mx-auto text-gray-600 mb-4" />
          <p className="text-gray-400 text-lg font-medium">No results found</p>
          <p className="text-gray-600 text-sm mt-1">Try a different search term or adjust your filters</p>
        </div>
      )}
      <ContextMenu />
    </div>
  );
});
SearchPage.displayName = 'SearchPage';

export default SearchPage;
