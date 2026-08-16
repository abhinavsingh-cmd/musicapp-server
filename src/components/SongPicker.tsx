import { useState, useMemo } from 'react';
import { Music2, Check, X, ChevronUp, ChevronDown } from 'lucide-react';
import { Song } from '../types/music';

type SongPickerTone = 'green' | 'violet';

/** Per-accent class overrides so the same picker fits any page's color scheme. */
const TONE_CLASSES: Record<SongPickerTone, { icon: string; selected: string; check: string; accent: string; focusRing: string }> = {
  green: {
    icon: 'text-green-400',
    selected: 'bg-green-500/20 border border-green-500/30',
    check: 'text-green-400',
    accent: 'accent-green-500',
    focusRing: 'focus:ring-green-500',
  },
  violet: {
    icon: 'text-violet-400',
    selected: 'bg-violet-500/20 border border-violet-500/30',
    check: 'text-violet-400',
    accent: 'accent-violet-500',
    focusRing: 'focus:ring-purple-500',
  },
};

interface SongPickerProps {
  /** The full catalog to pick from. */
  songs: Song[];
  /** Currently selected song ids (controlled by the parent for submit). */
  selected: string[];
  /** Toggle one song's selection. */
  onToggle: (songId: string) => void;
  /** Accent color scheme. Defaults to green. */
  tone?: SongPickerTone;
  /** Empty-state helper text — names the thing being built (playlist/album). */
  emptyText?: string;
}

/**
 * Searchable multi-select song picker with a checkbox grid and selected-chip
 * summary. Shared by the Create Playlist / Create Album forms.
 */
export function SongPicker({ songs, selected, onToggle, tone = 'green', emptyText = 'Click "Select Songs" to add tracks' }: SongPickerProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSongs = useMemo(() => songs.filter(s =>
    (s.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.artist || '').toLowerCase().includes(searchQuery.toLowerCase())
  ), [songs, searchQuery]);

  const t = TONE_CLASSES[tone];

  return (
    <div className="border-t border-white/5 pt-6">
      <div className="flex items-center justify-between mb-4">
        <label className="block text-sm font-medium text-gray-300 flex items-center gap-2">
          <Music2 size={16} className={t.icon} />
          Songs ({selected.length} selected)
        </label>
        <button
          type="button"
          onClick={() => setShowPicker(!showPicker)}
          className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-gray-300 hover:text-white transition-colors flex items-center gap-1"
        >
          {showPicker ? (
            <>Hide <ChevronUp size={14} /></>
          ) : (
            <>Select Songs <ChevronDown size={14} /></>
          )}
        </button>
      </div>

      {showPicker && (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          <input
            type="text"
            placeholder="Search songs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full px-4 py-2 rounded-xl bg-white/5 border border-white/5 text-white focus:outline-none focus:ring-2 ${t.focusRing}`}
          />
          <div className="grid gap-2 max-h-64 overflow-y-auto">
            {filteredSongs.slice(0, 50).map(song => (
              <label
                key={song.id}
                className={`flex items-center gap-3 p-2 rounded-xl transition-colors ${
                  selected.includes(song.id) ? t.selected : 'hover:bg-white/5'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(song.id)}
                  onChange={() => onToggle(song.id)}
                  className={`w-4 h-4 ${t.accent}`}
                />
                <img src={song.coverArt} alt={song.title} className="w-10 h-10 rounded-lg object-cover" loading="lazy" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{song.title}</p>
                  <p className="text-xs text-gray-400 truncate">{song.artist}</p>
                </div>
                {selected.includes(song.id) && (
                  <Check size={16} className={`${t.check} flex-shrink-0`} />
                )}
              </label>
            ))}
          </div>
          {filteredSongs.length === 0 && (
            <p className="text-center text-gray-500 py-4">No songs found</p>
          )}
        </div>
      )}

      {!showPicker && selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.slice(0, 10).map(id => {
            const song = songs.find(s => s.id === id);
            return song ? (
              <span key={song.id} className="px-2 py-1 bg-white/5 rounded-full text-xs text-gray-300 flex items-center gap-1">
                {song.title}
                <button type="button" onClick={() => onToggle(id)} className="text-red-400 hover:text-red-300">
                  <X size={12} />
                </button>
              </span>
            ) : null;
          })}
          {selected.length > 10 && (
            <span className="px-2 py-1 bg-white/5 rounded-full text-xs text-gray-400">
              +{selected.length - 10} more
            </span>
          )}
        </div>
      )}

      {!showPicker && selected.length === 0 && (
        <p className="text-center text-gray-500 py-4">{emptyText}</p>
      )}
    </div>
  );
}

export default SongPicker;
