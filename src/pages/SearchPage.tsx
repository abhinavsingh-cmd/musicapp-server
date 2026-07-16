import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search, X, Play, Music, Globe, Loader2, Download, Check,
  SlidersHorizontal, Clock, ArrowDownAZ, TrendingUp, Sparkles,
} from 'lucide-react';
import { SongTable } from '../features/library/SongTable';
import { Song } from '../types/music';
import { useAudioStore } from '../stores/audioStore';
import { useDownloadsStore } from '../stores/downloadsStore';
import { useDebounce } from '../hooks/useDebounce';
import {
  useSearchStore,
  selectFilteredLibrary,
  selectUniqueArtists,
  selectUniqueAlbums,
  selectUniqueGenres,
  FilterType,
  SortMode,
  DurationFilter,
  YTSong,
} from '../stores/searchStore';
import { cn } from '../utils/cn';

// ---- Filter chips ----

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

// ---- Component ----

export const SearchPage: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const debouncedQuery = useDebounce(query, 300);

  const {
    filter, sort, durationFilter, genreFilter,
    libraryResults, ytResults, suggestions,
    loading, ytLoading, hasMore,
    setFilter, setSort, setDurationFilter, setGenreFilter,
    search, loadMore, clear,
  } = useSearchStore();

  const filteredLibrary = useSearchStore(selectFilteredLibrary);
  const uniqueArtists = useSearchStore(selectUniqueArtists);
  const uniqueAlbums = useSearchStore(selectUniqueAlbums);
  const uniqueGenres = useSearchStore(selectUniqueGenres);

  const { loadSong } = useAudioStore();
  const { downloadSong, isDownloaded, isDownloading } = useDownloadsStore();

  // ---- Debounced search ----
  useEffect(() => {
    search(debouncedQuery);
    setShowSuggestions(true);
  }, [debouncedQuery, search]);

  // ---- Infinite scroll (YouTube results) ----
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !ytLoading && hasMore) loadMore(); },
      { rootMargin: '200px' },
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [ytLoading, hasMore, loadMore, ytResults.length]);

  // ---- Play YouTube result ----
  const handlePlayYT = useCallback((r: YTSong) => {
    const songs: Song[] = ytResults.map((item) => ({
      id: 'yt-' + item.id, youtubeId: item.id, title: item.title, artist: item.artist,
      genre: 'YouTube', duration: item.duration, coverArt: item.thumbnail,
      album: '', audioUrl: '', releaseYear: 0,
    }));
    const idx = songs.findIndex((s) => s.youtubeId === r.id);
    loadSong(songs[idx], songs, idx >= 0 ? idx : 0);
  }, [loadSong, ytResults]);

  const handleDownloadYT = useCallback((r: YTSong) => {
    downloadSong({
      id: 'yt-' + r.id, youtubeId: r.id, title: r.title, artist: r.artist,
      genre: 'YouTube', duration: r.duration, coverArt: r.thumbnail,
      album: '', audioUrl: '', releaseYear: 0,
    });
  }, [downloadSong]);

  const fmt = (s: number) => Math.floor(s / 60) + ':' + Math.floor(s % 60).toString().padStart(2, '0');
  const fmtViews = (n: number) =>
    n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toString();

  const handleSuggestionClick = (song: Song) => {
    setQuery(song.title);
    setShowSuggestions(false);
  };

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* ---- Search bar ---- */}
      <div className="relative max-w-xl">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={20} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          placeholder="Search songs, artists, albums..."
          className="w-full pl-12 pr-20 py-3 rounded-2xl bg-[#1a1a2e] border border-white/5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all"
          autoFocus
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

      {/* ---- Instant suggestions dropdown ---- */}
      {query && showSuggestions && suggestions.length > 0 && !loading && (
        <div className="max-w-xl relative z-20">
          <div className="rounded-2xl bg-[#1a1a2e] border border-white/5 overflow-hidden shadow-xl">
            {suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => handleSuggestionClick(s)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
              >
                <Search size={14} className="text-gray-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-white truncate">{s.title}</span>
                  <span className="text-xs text-gray-500 ml-2">· {s.artist}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---- Filter & Sort bar ---- */}
      {showFilters && (
        <div className="space-y-3 max-w-xl">
          {/* Type filters */}
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

          {/* Sort */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Sort</span>
            <div className="flex gap-1">
              {SORTS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSort(s.value)}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all",
                    sort === s.value
                      ? "bg-white/10 text-white"
                      : "text-gray-500 hover:text-gray-300",
                  )}
                >
                  {s.icon}{s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Duration */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Duration</span>
            <div className="flex gap-1">
              {DURATION_FILTERS.map((d) => (
                <button
                  key={d.value}
                  onClick={() => setDurationFilter(d.value)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-medium transition-all",
                    durationFilter === d.value
                      ? "bg-white/10 text-white"
                      : "text-gray-500 hover:text-gray-300",
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Genre filter */}
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

      {/* ---- Genre browse (no query) ---- */}
      {!query && (
        <div>
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Music size={20} className="text-violet-400" />Browse by Genre
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {GENRES.map((genre) => (
              <button
                key={genre}
                onClick={() => setQuery(genre)}
                className="p-4 rounded-xl claymorphism text-white font-medium hover:scale-105 active:scale-95 transition-all text-sm"
              >
                {genre}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---- Loading ---- */}
      {loading && (
        <div className="flex items-center gap-3 text-gray-400 py-8">
          <Loader2 size={20} className="animate-spin text-violet-400" />
          Searching your library...
        </div>
      )}

      {/* ---- Library results ---- */}
      {!loading && filteredLibrary.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Music size={14} />Your Library ({filteredLibrary.length})
          </h3>

          {/* Artists grid */}
          {filter === 'artists' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-4">
              {uniqueArtists.map((artist) => (
                <button
                  key={artist}
                  onClick={() => { setFilter('songs'); /* could filter by artist */ }}
                  className="p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-all text-center group"
                >
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 mx-auto mb-2 flex items-center justify-center text-white font-bold text-lg">
                    {artist[0]}
                  </div>
                  <span className="text-sm font-medium text-white truncate block">{artist}</span>
                </button>
              ))}
            </div>
          )}

          {/* Albums grid */}
          {filter === 'albums' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-4">
              {uniqueAlbums.map((album) => {
                const song = libraryResults.find((s) => s.album === album);
                return (
                  <button
                    key={album}
                    onClick={() => { setFilter('songs'); }}
                    className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all text-center group"
                  >
                    <div className="w-full aspect-square rounded-lg overflow-hidden bg-white/5 mb-2">
                      {song?.coverArt && <img src={song.coverArt} alt={album} className="w-full h-full object-cover" loading="lazy" />}
                    </div>
                    <span className="text-sm font-medium text-white truncate block">{album}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Songs table */}
          {filter !== 'artists' && filter !== 'albums' && (
            <div className="claymorphism rounded-2xl p-1">
              <SongTable songs={filteredLibrary} />
            </div>
          )}
        </div>
      )}

      {/* ---- YouTube results ---- */}
      {(ytLoading || ytResults.length > 0) && query && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Globe size={14} className="text-red-400" />YouTube {ytResults.length > 0 ? `(${ytResults.length})` : ''}
          </h3>
          {ytLoading && ytResults.length === 0 ? (
            <div className="flex items-center gap-3 text-gray-400 py-6">
              <Loader2 size={20} className="animate-spin text-violet-400" />Searching YouTube...
            </div>
          ) : (
            <div className="space-y-2">
              {ytResults.map((r) => (
                <div key={r.id} onClick={() => handlePlayYT(r)} className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors group cursor-pointer">
                  <div className="relative w-16 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-[#1a1a2e]">
                    <img src={r.thumbnail} alt={r.title} className="w-full h-full object-cover" loading="lazy" />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play size={16} fill="white" className="text-white" />
                    </div>
                    <span className="absolute bottom-0.5 right-0.5 px-1 py-0.5 bg-black/70 rounded text-[9px] text-white font-medium">
                      {fmt(r.duration)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{r.title}</div>
                    <div className="text-xs text-gray-400 truncate">{r.artist}</div>
                    {r.viewCount > 0 && <div className="text-[10px] text-gray-500">{fmtViews(r.viewCount)} views</div>}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); handlePlayYT(r); }} className="p-2 rounded-lg bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors">
                      <Play size={14} fill="currentColor" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDownloadYT(r); }}
                      disabled={isDownloaded(r.id) || isDownloading(r.id)}
                      className={cn(
                        "p-2 rounded-lg transition-colors",
                        isDownloaded(r.id) ? "bg-emerald-500/20 text-emerald-400"
                          : isDownloading(r.id) ? "bg-violet-500/20 text-violet-400"
                          : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white",
                      )}
                    >
                      {isDownloaded(r.id) ? <Check size={14} /> : isDownloading(r.id) ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    </button>
                  </div>
                </div>
              ))}

              {/* Infinite scroll sentinel */}
              <div ref={sentinelRef} className="h-4" />
              {ytLoading && ytResults.length > 0 && (
                <div className="flex justify-center py-4">
                  <Loader2 size={20} className="animate-spin text-violet-400" />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- No results ---- */}
      {query && !loading && !ytLoading && filteredLibrary.length === 0 && ytResults.length === 0 && (
        <div className="text-center text-gray-500 py-12">No results found for &ldquo;{query}&rdquo;</div>
      )}
    </div>
  );
};

export default SearchPage;
