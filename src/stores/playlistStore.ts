import { create } from 'zustand';
import { Playlist, Song } from '../types/music';

const STORAGE_KEY = 'playlists';

function loadPlaylists(): Playlist[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function savePlaylists(playlists: Playlist[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(playlists));
}

function generateShareToken(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

interface PlaylistStore {
  playlists: Playlist[];

  createPlaylist: (data: { name: string; description?: string; coverArt?: string; isPublic?: boolean; collaborative?: boolean; songIds?: string[] }) => Playlist;
  updatePlaylist: (id: string, data: Partial<Playlist>) => void;
  deletePlaylist: (id: string) => void;
  duplicatePlaylist: (id: string) => Playlist | null;

  addSong: (playlistId: string, song: Song) => void;
  addSongs: (playlistId: string, songs: Song[]) => void;
  removeSong: (playlistId: string, songId: string, songDuration?: number) => void;
  reorderSong: (playlistId: string, fromIndex: number, toIndex: number) => void;

  toggleFavorite: (id: string) => void;
  togglePublic: (id: string) => void;
  toggleCollaborative: (id: string) => void;

  generateShareLink: (id: string) => string;
  importPlaylist: (json: string) => boolean;
  exportPlaylist: (id: string) => string | null;

  getPlaylist: (id: string) => Playlist | undefined;
  getSongs: (id: string, allSongs: Song[]) => Song[];

  init: () => Promise<void>;
}

let initPromise: Promise<void> | null = null;

function initPlaylistStore() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (typeof window === 'undefined') return;
    const playlists = loadPlaylists();
    usePlaylistStore.setState({ playlists });
  })();
  return initPromise;
}

export const usePlaylistStore = create<PlaylistStore>((set, get) => ({
  playlists: [],

  init: async () => {
    await initPlaylistStore();
  },

  createPlaylist: (data) => {
    const now = new Date().toISOString();
    const playlist: Playlist = {
      id: 'pl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      name: data.name,
      description: data.description || '',
      coverArt: data.coverArt || '',
      songIds: data.songIds || [],
      trackCount: data.songIds?.length || 0,
      duration: 0,
      createdAt: now,
      updatedAt: now,
      isPublic: data.isPublic ?? false,
      isFavorite: false,
      collaborative: data.collaborative ?? false,
    };
    set((s) => {
      const updated = [playlist, ...s.playlists];
      savePlaylists(updated);
      return { playlists: updated };
    });
    return playlist;
  },

  updatePlaylist: (id, data) => {
    set((s) => {
      const updated = s.playlists.map((p) =>
        p.id === id ? { ...p, ...data, updatedAt: new Date().toISOString() } : p
      );
      savePlaylists(updated);
      return { playlists: updated };
    });
  },

  deletePlaylist: (id) => {
    set((s) => {
      const updated = s.playlists.filter((p) => p.id !== id);
      savePlaylists(updated);
      return { playlists: updated };
    });
  },

  duplicatePlaylist: (id) => {
    const source = get().playlists.find((p) => p.id === id);
    if (!source) return null;
    const now = new Date().toISOString();
    const dup: Playlist = {
      ...source,
      id: 'pl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      name: source.name + ' (Copy)',
      createdAt: now,
      updatedAt: now,
      isFavorite: false,
      shareToken: undefined,
    };
    set((s) => {
      const updated = [dup, ...s.playlists];
      savePlaylists(updated);
      return { playlists: updated };
    });
    return dup;
  },

  addSong: (playlistId, song) => {
    set((s) => {
      const updated = s.playlists.map((p) => {
        if (p.id !== playlistId) return p;
        if (p.songIds.includes(song.id)) return p;
        const songIds = [...p.songIds, song.id];
        return { ...p, songIds, trackCount: songIds.length, duration: p.duration + song.duration, updatedAt: new Date().toISOString() };
      });
      savePlaylists(updated);
      return { playlists: updated };
    });
  },

  addSongs: (playlistId, songs) => {
    set((s) => {
      const updated = s.playlists.map((p) => {
        if (p.id !== playlistId) return p;
        const existing = new Set(p.songIds);
        const newSongs = songs.filter((song) => !existing.has(song.id));
        if (newSongs.length === 0) return p;
        const songIds = [...p.songIds, ...newSongs.map((s) => s.id)];
        const addedDuration = newSongs.reduce((acc, s) => acc + s.duration, 0);
        return { ...p, songIds, trackCount: songIds.length, duration: p.duration + addedDuration, updatedAt: new Date().toISOString() };
      });
      savePlaylists(updated);
      return { playlists: updated };
    });
  },

  removeSong: (playlistId, songId, songDuration) => {
    set((s) => {
      const updated = s.playlists.map((p) => {
        if (p.id !== playlistId) return p;
        const idx = p.songIds.indexOf(songId);
        if (idx === -1) return p;
        const songIds = p.songIds.filter((id) => id !== songId);
        const removedDuration = songDuration ?? (p.trackCount > 0 ? Math.round(p.duration / p.trackCount) : 0);
        return { ...p, songIds, trackCount: songIds.length, duration: Math.max(0, p.duration - removedDuration), updatedAt: new Date().toISOString() };
      });
      savePlaylists(updated);
      return { playlists: updated };
    });
  },

  reorderSong: (playlistId, fromIndex, toIndex) => {
    set((s) => {
      const updated = s.playlists.map((p) => {
        if (p.id !== playlistId) return p;
        const ids = [...p.songIds];
        const [moved] = ids.splice(fromIndex, 1);
        ids.splice(toIndex, 0, moved);
        return { ...p, songIds: ids, updatedAt: new Date().toISOString() };
      });
      savePlaylists(updated);
      return { playlists: updated };
    });
  },

  toggleFavorite: (id) => {
    set((s) => {
      const updated = s.playlists.map((p) =>
        p.id === id ? { ...p, isFavorite: !p.isFavorite, updatedAt: new Date().toISOString() } : p
      );
      savePlaylists(updated);
      return { playlists: updated };
    });
  },

  togglePublic: (id) => {
    set((s) => {
      const updated = s.playlists.map((p) =>
        p.id === id ? { ...p, isPublic: !p.isPublic, updatedAt: new Date().toISOString() } : p
      );
      savePlaylists(updated);
      return { playlists: updated };
    });
  },

  toggleCollaborative: (id) => {
    set((s) => {
      const updated = s.playlists.map((p) =>
        p.id === id ? { ...p, collaborative: !p.collaborative, updatedAt: new Date().toISOString() } : p
      );
      savePlaylists(updated);
      return { playlists: updated };
    });
  },

  generateShareLink: (id) => {
    const p = get().playlists.find((pl) => pl.id === id);
    if (!p) return '';
    const token = p.shareToken || generateShareToken();
    if (!p.shareToken) {
      set((s) => {
        const updated = s.playlists.map((pl) =>
          pl.id === id ? { ...pl, shareToken: token } : pl
        );
        savePlaylists(updated);
        return { playlists: updated };
      });
    }
    return `${window.location.origin}/playlist/shared/${token}`;
  },

  exportPlaylist: (id) => {
    const p = get().playlists.find((pl) => pl.id === id);
    if (!p) return null;
    return JSON.stringify({ version: 1, playlist: p }, null, 2);
  },

  importPlaylist: (json) => {
    try {
      const data = JSON.parse(json);
      if (!data.playlist?.name) return false;
      const imported: Playlist = {
        ...data.playlist,
        id: 'pl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isFavorite: false,
        shareToken: undefined,
      };
      set((s) => {
        const updated = [imported, ...s.playlists];
        savePlaylists(updated);
        return { playlists: updated };
      });
      return true;
    } catch {
      return false;
    }
  },

  getPlaylist: (id) => get().playlists.find((p) => p.id === id),

  getSongs: (id, allSongs) => {
    const p = get().playlists.find((pl) => pl.id === id);
    if (!p) return [];
    const songMap = new Map(allSongs.map((s) => [s.id, s]));
    return p.songIds.map((sid) => songMap.get(sid)).filter(Boolean) as Song[];
  },
}));

if (typeof window !== 'undefined') {
  const deferInit = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb: IdleRequestCallback) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
  deferInit(() => { initPlaylistStore().catch(() => {}); });
}