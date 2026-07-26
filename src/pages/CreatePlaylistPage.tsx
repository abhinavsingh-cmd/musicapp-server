import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoBack } from '../hooks/useGoBack';
import { Plus, Image, Globe, Users, ArrowLeft, X, Check, Music2 } from 'lucide-react';
import { usePlaylistStore } from '../stores/playlistStore';
import { useSongsStore } from '../stores/songsStore';

export const CreatePlaylistPage: React.FC = () => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [collaborative, setCollaborative] = useState(false);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedSongs, setSelectedSongs] = useState<string[]>([]);
  const [showSongPicker, setShowSongPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const allSongs = useSongsStore((s) => s.songs);
  const loading = useSongsStore((s) => s.loading);
  const ensureLoaded = useSongsStore((s) => s.ensureLoaded);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const goBack = useGoBack();
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);

  useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

  const filteredSongs = useMemo(() => allSongs.filter(s =>
    (s.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.artist || '').toLowerCase().includes(searchQuery.toLowerCase())
  ), [allSongs, searchQuery]);

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => setCoverPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleSongToggle = (songId: string) => {
    setSelectedSongs(prev =>
      prev.includes(songId)
        ? prev.filter(id => id !== songId)
        : [...prev, songId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createPlaylist({
      name: name.trim(),
      description: description.trim(),
      coverArt: coverPreview || '',
      isPublic,
      collaborative,
      songIds: selectedSongs,
    });
    navigate('/library?tab=playlists');
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin text-green-500 text-xl">Loading songs...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-lg mx-auto">
      <button
        onClick={goBack}
        className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft size={18} />
        Back
      </button>

      <h2 className="text-2xl font-bold text-white flex items-center gap-3 mb-8">
        <span className="p-2 rounded-xl bg-green-500/10"><Plus size={20} className="text-green-400" /></span>
        Create Playlist
      </h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Cover image */}
        <div
          className={`w-48 h-48 mx-auto rounded-2xl border-2 border-dashed flex items-center justify-center cursor-pointer transition-all ${
            dragActive ? 'border-green-400 bg-green-500/10' : 'border-green-300 dark:border-green-700 bg-gradient-to-br from-green-500/20 to-teal-500/20 hover:border-green-400'
          }`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          {coverPreview ? (
            <img src={coverPreview} alt="Cover" className="w-full h-full object-cover rounded-2xl" />
          ) : (
            <div className="text-center">
              <Image size={36} className="text-green-400 mx-auto mb-2" />
              <p className="text-xs text-green-400/80">Drop image or click</p>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Playlist"
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/5 text-white focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
            required
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add an optional description..."
            rows={3}
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/5 text-white focus:outline-none focus:ring-2 focus:ring-green-500 resize-none transition-all"
          />
        </div>

        {/* Song Selection */}
        <div className="border-t border-white/5 pt-6">
          <div className="flex items-center justify-between mb-4">
            <label className="block text-sm font-medium text-gray-300 flex items-center gap-2">
              <Music2 size={16} className="text-green-400" />
              Songs ({selectedSongs.length} selected)
            </label>
            <button
              type="button"
              onClick={() => setShowSongPicker(!showSongPicker)}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-gray-300 hover:text-white transition-colors"
            >
              {showSongPicker ? 'Hide' : 'Select Songs'}
            </button>
          </div>

          {showSongPicker && (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              <input
                type="text"
                placeholder="Search songs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/5 text-white focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <div className="grid gap-2 max-h-64 overflow-y-auto">
                {filteredSongs.slice(0, 50).map(song => (
                  <label
                    key={song.id}
                    className={`flex items-center gap-3 p-2 rounded-xl transition-colors ${
                      selectedSongs.includes(song.id)
                        ? 'bg-green-500/20 border border-green-500/30'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSongs.includes(song.id)}
                      onChange={() => handleSongToggle(song.id)}
                      className="w-4 h-4 accent-green-500"
                    />
                    <img src={song.coverArt} alt={song.title} className="w-10 h-10 rounded-lg object-cover" loading="lazy" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{song.title}</p>
                      <p className="text-xs text-gray-400 truncate">{song.artist}</p>
                    </div>
                    {selectedSongs.includes(song.id) && (
                      <Check size={16} className="text-green-400 flex-shrink-0" />
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
            <p className="text-center text-gray-500 py-4">Click "Select Songs" to add tracks to your playlist</p>
          )}
        </div>

        {/* Toggles */}
        <div className="space-y-3 border-t border-white/5 pt-6">
          <button
            type="button"
            onClick={() => setIsPublic(!isPublic)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
              isPublic ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
            }`}
          >
            <Globe size={18} />
            <div className="text-left flex-1">
              <p className="text-sm font-medium">Public</p>
              <p className="text-xs opacity-60">Anyone can find this playlist</p>
            </div>
            <div className={`w-10 h-5 rounded-full transition-all relative ${isPublic ? 'bg-green-500' : 'bg-gray-600'}`}>
              <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${isPublic ? 'left-5' : 'left-0.5'}`} />
            </div>
          </button>

          <button
            type="button"
            onClick={() => setCollaborative(!collaborative)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
              collaborative ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
            }`}
          >
            <Users size={18} />
            <div className="text-left flex-1">
              <p className="text-sm font-medium">Collaborative</p>
              <p className="text-xs opacity-60">Others can add songs</p>
            </div>
            <div className={`w-10 h-5 rounded-full transition-all relative ${collaborative ? 'bg-green-500' : 'bg-gray-600'}`}>
              <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${collaborative ? 'left-5' : 'left-0.5'}`} />
            </div>
          </button>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!name.trim()}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-green-500/25 active:scale-[0.98] transition-all"
        >
          Create Playlist
        </button>
      </form>
    </div>
  );
};

export default CreatePlaylistPage;