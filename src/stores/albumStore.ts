import { create } from 'zustand';
import { Album, Song } from '../types/music';

const STORAGE_KEY = 'albums';

function loadAlbums(): Album[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function saveAlbums(albums: Album[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(albums));
}

interface AlbumStore {
  albums: Album[];

  // CRUD
  createAlbum: (data: { title: string; artist: string; coverArt?: string; releaseYear: number; genre: string; songIds: string[]; allSongs: Song[] }) => Album;
  updateAlbum: (id: string, data: Partial<Album>) => void;
  deleteAlbum: (id: string) => void;
  duplicateAlbum: (id: string) => Album | null;

  // Songs
  addSong: (albumId: string, song: Song) => void;
  addSongs: (albumId: string, songs: Song[]) => void;
  removeSong: (albumId: string, songId: string) => void;
  reorderSong: (albumId: string, fromIndex: number, toIndex: number) => void;

  // Helpers
  getAlbum: (id: string) => Album | undefined;
  getSongs: (id: string, allSongs: Song[]) => Song[];
}

export const useAlbumStore = create<AlbumStore>((set, get) => ({
  albums: loadAlbums(),

  createAlbum: (data) => {
    const { allSongs, ...rest } = data;
    const songMap = new Map(allSongs.map(s => [s.id, s]));
    const duration = rest.songIds.reduce((acc, id) => acc + (songMap.get(id)?.duration || 0), 0);

    const album: Album = {
      id: 'al-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      title: rest.title,
      artist: rest.artist,
      coverArt: rest.coverArt || '',
      releaseYear: rest.releaseYear,
      songIds: rest.songIds,
      trackCount: rest.songIds.length,
      duration,
      genre: rest.genre,
    };
    set((s) => {
      const updated = [album, ...s.albums];
      saveAlbums(updated);
      return { albums: updated };
    });
    return album;
  },

  updateAlbum: (id, data) => {
    set((s) => {
      const updated = s.albums.map((a) =>
        a.id === id ? { ...a, ...data } : a
      );
      saveAlbums(updated);
      return { albums: updated };
    });
  },

  deleteAlbum: (id) => {
    set((s) => {
      const updated = s.albums.filter((a) => a.id !== id);
      saveAlbums(updated);
      return { albums: updated };
    });
  },

  duplicateAlbum: (id) => {
    const source = get().albums.find((a) => a.id === id);
    if (!source) return null;
    const dup: Album = {
      ...source,
      id: 'al-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      title: source.title + ' (Copy)',
    };
    set((s) => {
      const updated = [dup, ...s.albums];
      saveAlbums(updated);
      return { albums: updated };
    });
    return dup;
  },

  addSong: (albumId, song) => {
    set((s) => {
      const updated = s.albums.map((a) => {
        if (a.id !== albumId) return a;
        if (a.songIds.includes(song.id)) return a;
        const songIds = [...a.songIds, song.id];
        return { ...a, songIds, trackCount: songIds.length, duration: a.duration + song.duration };
      });
      saveAlbums(updated);
      return { albums: updated };
    });
  },

  addSongs: (albumId, songs) => {
    set((s) => {
      const updated = s.albums.map((a) => {
        if (a.id !== albumId) return a;
        const existing = new Set(a.songIds);
        const newSongs = songs.filter((song) => !existing.has(song.id));
        if (newSongs.length === 0) return a;
        const songIds = [...a.songIds, ...newSongs.map((s) => s.id)];
        const addedDuration = newSongs.reduce((acc, s) => acc + s.duration, 0);
        return { ...a, songIds, trackCount: songIds.length, duration: a.duration + addedDuration };
      });
      saveAlbums(updated);
      return { albums: updated };
    });
  },

  removeSong: (albumId, songId) => {
    set((s) => {
      const updated = s.albums.map((a) => {
        if (a.id !== albumId) return a;
        const idx = a.songIds.indexOf(songId);
        if (idx === -1) return a;
        const songIds = a.songIds.filter((id) => id !== songId);
        const avgDuration = a.trackCount > 1 ? a.duration / a.trackCount : 0;
        const newDuration = Math.max(0, Math.round(avgDuration * songIds.length));
        return { ...a, songIds, trackCount: songIds.length, duration: newDuration };
      });
      saveAlbums(updated);
      return { albums: updated };
    });
  },

  reorderSong: (albumId, fromIndex, toIndex) => {
    set((s) => {
      const updated = s.albums.map((a) => {
        if (a.id !== albumId) return a;
        const ids = [...a.songIds];
        const [moved] = ids.splice(fromIndex, 1);
        ids.splice(toIndex, 0, moved);
        return { ...a, songIds: ids };
      });
      saveAlbums(updated);
      return { albums: updated };
    });
  },

  getAlbum: (id) => get().albums.find((a) => a.id === id),

  getSongs: (id, allSongs) => {
    const a = get().albums.find((al) => al.id === id);
    if (!a) return [];
    const songMap = new Map(allSongs.map((s) => [s.id, s]));
    return a.songIds.map((sid) => songMap.get(sid)).filter(Boolean) as Song[];
  },
}));