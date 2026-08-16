import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoBack } from '../hooks/useGoBack';
import { useAlbumStore } from '../stores/albumStore';
import { useSongsStore } from '../stores/songsStore';
import { Plus, Disc, ArrowLeft } from 'lucide-react';
import { SongPicker } from '../components/SongPicker';

export const CreateAlbumPage: React.FC = () => {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [year, setYear] = useState('2025');
  const [genre, setGenre] = useState('Pop');
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [selectedSongs, setSelectedSongs] = useState<string[]>([]);
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
        <SongPicker
          songs={allSongs}
          selected={selectedSongs}
          onToggle={handleSongToggle}
          tone="violet"
          emptyText={'Click "Select Songs" to add tracks to your album'}
        />

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