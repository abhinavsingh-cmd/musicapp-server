import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoBack } from '../hooks/useGoBack';
import { useAlbumStore } from '../stores/albumStore';
import { useSongsStore } from '../stores/songsStore';
import { Plus, Disc, X, Music2, Check, ChevronUp, ChevronDown, ArrowLeft } from 'lucide-react';

export const CreateAlbumPage: React.FC = () => {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [year, setYear] = useState('2025');
  const [genre, setGenre] = useState('Pop');
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [selectedSongs, setSelectedSongs] = useState<string[]>([]);
  const [showSongPicker, setShowSongPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const allSongs = useSongsStore((s) => s.songs);
  const loading = useSongsStore((s) => s.loading);
  const ensureLoaded = useSongsStore((s) => s.ensureLoaded);
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const goBack = useGoBack();
  const createAlbum = useAlbumStore((s) => s.createAlbum);

  const genres = ['Pop', 'Rock', 'Hip Hop', 'R&B', 'Electronic', 'Indie', 'Jazz', 'Classical', 'Country', 'Folk', 'Metal', 'Punk', 'Reggae', 'Blues', 'Soul', 'Funk', 'Disco', 'House', 'Techno', 'Trance', 'Ambient', 'Soundtrack', 'Other'];

  useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

  const filteredSongs = useMemo(() => allSongs.filter(s =>
    (s.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.artist || '').toLowerCase().includes(searchQuery.toLowerCase())
  ), [allSongs, searchQuery]);

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setCoverPreview(result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSongToggle = (songId: string) => {
    setSelectedSongs(prev =>
      prev.includes(songId)
        ? prev.filter(id => id !== songId)
        : [...prev, songId]
    );
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setCoverPreview(result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !artist.trim() || selectedSongs.length === 0) return;

    createAlbum({
      title: title.trim(),
      artist: artist.trim(),
      coverArt: coverPreview || '',
      releaseYear: parseInt(year) || 2025,
      genre,
      songIds: selectedSongs,
      allSongs,
    });

    navigate('/library?tab=albums');
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin text-orange-500 text-xl">Loading songs...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={goBack} className="p-2 rounded-xl hover:bg-white/5 transition-colors text-gray-400 hover:text-white" aria-label="Go back">
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          <span className="p-2 rounded-xl bg-orange-500/20"><Plus size={20} className="text-orange-500" /></span>
          New Album
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 bg-[#1a1a2e] rounded-2xl p-6 border border-white/5">
        {/* Cover Art */}
        <div className="relative">
          <div
            className={`w-64 h-64 mx-auto rounded-2xl border-2 border-dashed flex items-center justify-center transition-all ${
              dragActive
                ? 'border-orange-400 bg-orange-500/10'
                : 'border-orange-300 dark:border-orange-700 bg-gradient-to-br from-orange-500/20 to-red-500/20 hover:border-orange-400'
            }`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            {coverPreview ? (
              <img src={coverPreview} alt="Cover preview" className="w-full h-full object-cover rounded-xl" />
            ) : (
              <Disc size={48} className="text-orange-400" />
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleCoverChange}
              className="hidden"
              id="cover-upload"
            />
          </div>
          <label htmlFor="cover-upload" className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/70 rounded-full text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity">
            {coverPreview ? 'Change cover' : 'Upload cover art'}
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Album Title *</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Album Title"
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500" required />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Artist *</label>
            <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist Name"
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500" required />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Release Year</label>
            <input type="number" value={year} onChange={(e) => setYear(e.target.value)} min="1900" max="2030"
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Genre</label>
            <select value={genre} onChange={(e) => setGenre(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
              {genres.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>

        {/* Song Selection */}
        <div className="border-t border-white/5 pt-6">
          <div className="flex items-center justify-between mb-4">
            <label className="block text-sm font-medium text-gray-300 flex items-center gap-2">
              <Music2 size={16} className="text-orange-400" />
              Songs ({selectedSongs.length} selected)
            </label>
            <button
              type="button"
              onClick={() => setShowSongPicker(!showSongPicker)}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-gray-300 hover:text-white transition-colors flex items-center gap-1"
            >
              {showSongPicker ? (
                <>Hide <ChevronUp size={14} /></>
              ) : (
                <>Select Songs <ChevronDown size={14} /></>
              )}
            </button>
          </div>

          {showSongPicker && (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              <input
                type="text"
                placeholder="Search songs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <div className="grid gap-2 max-h-64 overflow-y-auto">
                {filteredSongs.slice(0, 50).map(song => (
                  <label
                    key={song.id}
                    className={`flex items-center gap-3 p-2 rounded-xl transition-colors ${
                      selectedSongs.includes(song.id)
                        ? 'bg-violet-500/20 border border-violet-500/30'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSongs.includes(song.id)}
                      onChange={() => handleSongToggle(song.id)}
                      className="w-4 h-4 accent-violet-500"
                    />
                    <img src={song.coverArt} alt={song.title} className="w-10 h-10 rounded-lg object-cover" loading="lazy" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{song.title}</p>
                      <p className="text-xs text-gray-400 truncate">{song.artist}</p>
                    </div>
                    {selectedSongs.includes(song.id) && (
                      <Check size={16} className="text-violet-400 flex-shrink-0" />
                    )}
                  </label>
                ))}
              </div>
              {filteredSongs.length === 0 && (
                <p className="text-center text-gray-500 py-4">No songs found</p>
              )}
            </div>
          )}

          {!showSongPicker && selectedSongs.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedSongs.slice(0, 10).map(id => {
                const song = allSongs.find(s => s.id === id);
                return song ? (
                  <span key={song.id} className="px-2 py-1 bg-white/5 rounded-full text-xs text-gray-300 flex items-center gap-1">
                    {song.title}
                    <button type="button" onClick={() => handleSongToggle(id)} className="text-red-400 hover:text-red-300">
                      <X size={12} />
                    </button>
                  </span>
                ) : null;
              })}
              {selectedSongs.length > 10 && (
                <span className="px-2 py-1 bg-white/5 rounded-full text-xs text-gray-400">
                  +{selectedSongs.length - 10} more
                </span>
              )}
            </div>
          )}

          {!showSongPicker && selectedSongs.length === 0 && (
            <p className="text-center text-gray-500 py-4">Click "Select Songs" to add tracks to your album</p>
          )}
        </div>

        {/* Submit */}
        <button type="submit" disabled={!title.trim() || !artist.trim() || selectedSongs.length === 0}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg transition-all">
          Create Album
        </button>
      </form>
    </div>
  );
};

export default CreateAlbumPage;