import React, { useState, useRef, useMemo, useEffect } from 'react';
import { usePlaylistStore } from '../../stores/playlistStore';
import { useAudioStore } from '../../stores/audioStore';
import { useQueueStore } from '../../stores/queueStore';
import { useDownloadsStore } from '../../stores/downloadsStore';
import { useSongsStore } from '../../stores/songsStore';
import { Playlist, Song } from '../../types/music';
import { cn } from '../../utils/cn';
import { favoriteKey } from '../../utils/songIds';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft, Play, Shuffle, Pause, Search, GripVertical, X, Trash2,
  Heart, Globe, Users, Share2, Download, Check, MoreVertical,
  Pencil, Copy, FileDown, FileUp, Music, Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ---- Sortable song row for playlist ----

interface SortablePlaylistSongRowProps {
  song: Song;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: () => void;
  onRemove: () => void;
}

const SortablePlaylistSongRow: React.FC<SortablePlaylistSongRowProps> = React.memo(({
  song, index, isCurrent, isPlaying, onPlay, onRemove,
}) => {
  const isDownloadedFn = useDownloadsStore((s) => s.isDownloaded);
  const isDownloadingFn = useDownloadsStore((s) => s.isDownloading);
  const downloadSong = useDownloadsStore((s) => s.downloadSong);
  const favorites = useAudioStore((s) => s.favorites);
  const toggleFavorite = useAudioStore((s) => s.toggleFavorite);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: song.id + '-' + index });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.8 : 1,
  };

  const fmt = (s: number) => Math.floor(s / 60) + ':' + Math.floor(s % 60).toString().padStart(2, '0');

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-xl group transition-all duration-200",
        isCurrent && "bg-violet-500/15 border border-violet-500/20",
        !isCurrent && "hover:bg-white/5",
        isDragging && "shadow-lg shadow-violet-500/20"
      )}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 touch-none flex-shrink-0"
      >
        <GripVertical size={14} />
      </button>

      {/* Index / play indicator */}
      <button onClick={onPlay} className="w-6 text-center flex-shrink-0">
        {isCurrent ? (
          <div className="flex items-center justify-center">
            {isPlaying ? (
              <div className="flex items-end gap-0.5 h-3">
                <div className="w-0.5 bg-violet-400 rounded-full animate-[eq-bounce_0.8s_ease-in-out_infinite]" style={{ animationDelay: '0s' }} />
                <div className="w-0.5 bg-violet-400 rounded-full animate-[eq-bounce_0.8s_ease-in-out_infinite]" style={{ animationDelay: '0.1s' }} />
                <div className="w-0.5 bg-violet-400 rounded-full animate-[eq-bounce_0.8s_ease-in-out_infinite]" style={{ animationDelay: '0.2s' }} />
              </div>
            ) : (
              <Pause size={12} className="text-violet-400" />
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-600 group-hover:hidden">{index + 1}</span>
        )}
        {!isCurrent && <Play size={12} className="text-gray-400 hidden group-hover:block" />}
      </button>

      {/* Cover art */}
      <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
        {song.coverArt ? (
          <img src={song.coverArt} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music size={14} className="text-gray-600" />
          </div>
        )}
      </div>

      {/* Song info */}
      <button onClick={onPlay} className="flex-1 min-w-0 text-left">
        <p className={cn("text-sm font-medium truncate", isCurrent ? "text-violet-300" : "text-white")}>
          {song.title}
        </p>
        <p className="text-xs text-gray-500 truncate">{song.artist}</p>
      </button>

      {/* Duration */}
      <span className="text-xs text-gray-600 flex-shrink-0 hidden sm:block">{fmt(song.duration)}</span>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite(favoriteKey(song)); }}
          className={cn(
            "p-1.5 rounded-lg transition-all",
            favorites.includes(favoriteKey(song)) ? "text-red-500" : "text-gray-500 hover:text-red-400"
          )}
        >
          <Heart size={14} fill={favorites.includes(favoriteKey(song)) ? "currentColor" : "none"} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); const key = song.youtubeId || song.id; if (isDownloadingFn(key)) return; if (!isDownloadedFn(key)) downloadSong(song); }}
          disabled={isDownloadedFn(song.youtubeId || song.id) && !isDownloadingFn(song.youtubeId || song.id)}
          className={cn(
            "p-1.5 rounded-lg transition-all",
            isDownloadedFn(song.youtubeId || song.id) ? "text-emerald-400" : isDownloadingFn(song.youtubeId || song.id) ? "text-violet-400" : "text-gray-500 hover:text-violet-400"
          )}
        >
          {isDownloadedFn(song.youtubeId || song.id) ? <Check size={14} /> : isDownloadingFn(song.youtubeId || song.id) ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="p-1.5 rounded-lg text-gray-500 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
});
SortablePlaylistSongRow.displayName = 'SortablePlaylistSongRow';

const PlaylistSongRowWrapper = React.memo(({ song, index, realIndex, isCurrent, isPlaying, playlistSongs, playlistId }: {
  song: Song; index: number; realIndex: number; isCurrent: boolean; isPlaying: boolean; playlistSongs: Song[]; playlistId: string;
}) => {
  const loadSong = useAudioStore((s) => s.loadSong);
  const togglePlayPause = useAudioStore((s) => s.togglePlayPause);
  const currentSongId = useAudioStore((s) => s.currentSong?.id);
  const removeSong = usePlaylistStore((s) => s.removeSong);

  const handlePlay = React.useCallback(() => {
    if (currentSongId === song.id) {
      togglePlayPause();
    } else {
      loadSong(song, playlistSongs, realIndex);
    }
  }, [song, playlistSongs, realIndex, currentSongId, loadSong, togglePlayPause]);

  const handleRemove = React.useCallback(() => {
    removeSong(playlistId, song.id);
  }, [playlistId, song.id, removeSong]);

  return (
    <SortablePlaylistSongRow
      song={song}
      index={index}
      isCurrent={isCurrent}
      isPlaying={isPlaying}
      onPlay={handlePlay}
      onRemove={handleRemove}
    />
  );
});
PlaylistSongRowWrapper.displayName = 'PlaylistSongRowWrapper';

interface PlaylistDetailProps {
  playlist: Playlist;
  onClose: () => void;
}

export const PlaylistDetail: React.FC<PlaylistDetailProps> = ({ playlist, onClose }) => {
  const updatePlaylist = usePlaylistStore((s) => s.updatePlaylist);
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);
  const duplicatePlaylist = usePlaylistStore((s) => s.duplicatePlaylist);
  const toggleFavorite = usePlaylistStore((s) => s.toggleFavorite);
  const togglePublic = usePlaylistStore((s) => s.togglePublic);
  const toggleCollaborative = usePlaylistStore((s) => s.toggleCollaborative);
  const generateShareLink = usePlaylistStore((s) => s.generateShareLink);
  const exportPlaylist = usePlaylistStore((s) => s.exportPlaylist);
  const reorderSong = usePlaylistStore((s) => s.reorderSong);
  const loadSong = useAudioStore((s) => s.loadSong);
  const currentSong = useAudioStore((s) => s.currentSong);
  const isPlaying = useAudioStore((s) => s.isPlaying);
  const library = useSongsStore((s) => s.songs);
  const ensureLoaded = useSongsStore((s) => s.ensureLoaded);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  const [searchQuery, setSearchQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(playlist.name);
  const [editDesc, setEditDesc] = useState(playlist.description || '');
  const [showShareToast, setShowShareToast] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importSuccess, setImportSuccess] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  // Resolve songs from IDs
  const playlistSongs = useMemo(() => {
    const songMap = new Map(library.map((s) => [s.id, s]));
    return (playlist.songIds || []).map((id) => songMap.get(id)).filter(Boolean) as Song[];
  }, [playlist.songIds, library]);

  // Filter songs by search
  const filteredSongs = useMemo(() => {
    if (!searchQuery.trim()) return playlistSongs;
    const q = searchQuery.toLowerCase();
    return playlistSongs.filter(
      (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
    );
  }, [playlistSongs, searchQuery]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ---- Handlers ----

  const handlePlayAll = React.useCallback(() => {
    if (playlistSongs.length > 0) {
      loadSong(playlistSongs[0], playlistSongs, 0);
    }
  }, [playlistSongs, loadSong]);

  const handleShufflePlay = React.useCallback(() => {
    if (playlistSongs.length > 0) {
      const qs = useQueueStore.getState();
      if (!qs.isShuffled) qs.toggleShuffle();
      const shuffled = [...playlistSongs].sort(() => 0.5 - Math.random());
      loadSong(shuffled[0], shuffled, 0);
    }
  }, [playlistSongs, loadSong]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = playlistSongs.findIndex((s, i) => (s.id + '-' + i) === String(active.id));
    const newIndex = playlistSongs.findIndex((s, i) => (s.id + '-' + i) === String(over.id));
    if (oldIndex !== -1 && newIndex !== -1) {
      reorderSong(playlist.id, oldIndex, newIndex);
    }
  };

  const handleSaveEdit = () => {
    updatePlaylist(playlist.id, { name: editName.trim() || playlist.name, description: editDesc.trim() });
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (confirm('Delete this playlist?')) {
      deletePlaylist(playlist.id);
      onClose();
    }
  };

  const handleDuplicate = () => {
    const dup = duplicatePlaylist(playlist.id);
    if (dup) {
      onClose();
    }
  };

  const handleShare = () => {
    const url = generateShareLink(playlist.id);
    navigator.clipboard.writeText(url).then(() => {
      setShowShareToast(true);
      setTimeout(() => { if (mountedRef.current) setShowShareToast(false); }, 2000);
    });
  };

  const handleExport = () => {
    const json = exportPlaylist(playlist.id);
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${playlist.name.replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const ok = usePlaylistStore.getState().importPlaylist(importText);
    setImportSuccess(ok);
    setTimeout(() => { if (mountedRef.current) { setImportSuccess(null); setShowImport(false); setImportText(''); } }, 1500);
  };

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      updatePlaylist(playlist.id, { coverArt: ev.target?.result as string });
    };
    reader.readAsDataURL(file);
  };

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m} min`;
  };

  return (
    <div className="min-h-screen bg-[#0a0a14]">
      {/* Header bar */}
      <div className="sticky top-0 z-50 bg-[#0a0a14]/95 border-b border-white/5">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all">
            <ArrowLeft size={18} className="text-white" />
          </button>
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleSaveEdit}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                className="w-full bg-transparent text-white font-bold text-lg focus:outline-none border-b border-violet-500"
                autoFocus
              />
            ) : (
              <h1 className="text-white font-bold text-lg truncate">{playlist.name}</h1>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all"
              title="Edit name"
            >
              <Pencil size={16} className="text-gray-400" />
            </button>
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all"
              >
                <MoreVertical size={16} className="text-gray-400" />
              </button>
              <AnimatePresence>
                {showMenu && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -5 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -5 }}
                    className="absolute right-0 top-full mt-2 w-52 bg-[#1a1a2e] rounded-xl border border-white/10 shadow-2xl overflow-hidden z-50"
                  >
                    <button onClick={() => { toggleFavorite(playlist.id); setShowMenu(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-all">
                      <Heart size={16} className={playlist.isFavorite ? "text-red-500" : ""} />
                      {playlist.isFavorite ? 'Unfavorite' : 'Favorite'}
                    </button>
                    <button onClick={() => { togglePublic(playlist.id); setShowMenu(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-all">
                      <Globe size={16} className={playlist.isPublic ? "text-green-400" : ""} />
                      {playlist.isPublic ? 'Make Private' : 'Make Public'}
                    </button>
                    <button onClick={() => { toggleCollaborative(playlist.id); setShowMenu(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-all">
                      <Users size={16} className={playlist.collaborative ? "text-blue-400" : ""} />
                      {playlist.collaborative ? 'Disable Collaborative' : 'Enable Collaborative'}
                    </button>
                    <div className="border-t border-white/5 my-1" />
                    <button onClick={() => { handleShare(); setShowMenu(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-all">
                      <Share2 size={16} />
                      Share Link
                    </button>
                    <button onClick={() => { handleExport(); setShowMenu(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-all">
                      <FileDown size={16} />
                      Export as JSON
                    </button>
                    <button onClick={() => { setShowImport(true); setShowMenu(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-all">
                      <FileUp size={16} />
                      Import Playlist
                    </button>
                    <button onClick={() => { handleDuplicate(); setShowMenu(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-all">
                      <Copy size={16} />
                      Duplicate
                    </button>
                    <div className="border-t border-white/5 my-1" />
                    <button onClick={() => { handleDelete(); setShowMenu(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-all">
                      <Trash2 size={16} />
                      Delete Playlist
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Hero */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-5">
          {/* Cover */}
          <div
            className="w-40 h-40 sm:w-48 sm:h-48 rounded-2xl overflow-hidden bg-white/5 flex-shrink-0 cursor-pointer group relative"
            onClick={() => fileRef.current?.click()}
          >
            {playlist.coverArt ? (
              <img src={playlist.coverArt} alt={playlist.name} loading="lazy" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-500/20 to-pink-500/20">
                <Music size={48} className="text-violet-400" />
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <Pencil size={20} className="text-white" />
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
          </div>

          {/* Info + actions */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Playlist</p>
            {isEditing ? (
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                onBlur={handleSaveEdit}
                placeholder="Add description..."
                rows={2}
                className="w-full bg-transparent text-white/70 text-sm focus:outline-none border-b border-violet-500/50 resize-none"
              />
            ) : (
              <p className="text-sm text-gray-400 mb-2 line-clamp-2">{playlist.description || 'No description'}</p>
            )}
            <div className="flex items-center gap-3 text-xs text-gray-500 mb-4">
              <span>{playlistSongs.length} songs</span>
              <span>·</span>
              <span>{fmt(playlist.duration)}</span>
              {playlist.isPublic && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1"><Globe size={10} /> Public</span>
                </>
              )}
              {playlist.collaborative && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1"><Users size={10} /> Collaborative</span>
                </>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={handlePlayAll}
                disabled={playlistSongs.length === 0}
                className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-gray-900 font-bold text-sm hover:scale-105 active:scale-95 transition-transform shadow-xl disabled:opacity-50"
              >
                <Play size={16} fill="currentColor" />
                Play All
              </button>
              <button
                onClick={handleShufflePlay}
                disabled={playlistSongs.length === 0}
                className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-white/10 text-white font-bold text-sm hover:bg-white/20 active:scale-95 transition-all disabled:opacity-50"
              >
                <Shuffle size={16} />
                Shuffle
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Search bar */}
      {playlistSongs.length > 0 && (
        <div className="px-6 pb-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in playlist..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition-all"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Song list with drag */}
      <div className="px-4 pb-24">
        {filteredSongs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <Music size={40} className="mb-3 text-gray-700" />
            <p className="text-sm">{playlistSongs.length === 0 ? 'This playlist is empty' : 'No matches found'}</p>
            <p className="text-xs text-gray-700 mt-1">{playlistSongs.length === 0 ? 'Search for songs to add' : 'Try a different search'}</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={filteredSongs.map((s) => s.id + '-' + playlistSongs.indexOf(s))} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {filteredSongs.map((song) => {
                  const realIndex = playlistSongs.indexOf(song);
                  return (
                    <PlaylistSongRowWrapper
                      key={song.id + '-' + realIndex}
                      song={song}
                      index={realIndex}
                      realIndex={realIndex}
                      isCurrent={currentSong?.id === song.id}
                      isPlaying={currentSong?.id === song.id && isPlaying}
                      playlistSongs={playlistSongs}
                      playlistId={playlist.id}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Share toast */}
      <AnimatePresence>
        {showShareToast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-emerald-500/90 backdrop-blur-sm text-white px-4 py-2 rounded-xl text-sm font-medium shadow-xl z-[100]"
          >
            Link copied!
          </motion.div>
        )}
      </AnimatePresence>

      {/* Import modal */}
      <AnimatePresence>
        {showImport && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowImport(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-[#1a1a2e] rounded-2xl p-6 border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-white font-bold text-lg mb-4">Import Playlist</h3>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Paste playlist JSON here..."
                rows={6}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-none mb-4"
              />
              {importSuccess === true && <p className="text-emerald-400 text-sm mb-3">Imported successfully!</p>}
              {importSuccess === false && <p className="text-red-400 text-sm mb-3">Invalid playlist data</p>}
              <div className="flex gap-3">
                <button onClick={() => setShowImport(false)} className="flex-1 py-2.5 rounded-xl bg-white/5 text-gray-300 text-sm hover:bg-white/10 transition-all">
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={!importText.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-violet-500 text-white text-sm font-semibold disabled:opacity-50 hover:bg-violet-600 transition-all"
                >
                  Import
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Click-away for menu */}
      {showMenu && <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />}
    </div>
  );
};
