import React, { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePlaylistStore } from '../stores/playlistStore';
import { PlaylistDetail } from '../features/playlist/PlaylistDetail';

const PlaylistDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const playlists = usePlaylistStore((s) => s.playlists);

  const playlist = useMemo(() => playlists.find((p) => p.id === id), [playlists, id]);

  if (!playlist) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <p className="text-gray-400 text-lg">Playlist not found</p>
          <button
            onClick={() => navigate('/library?tab=playlists')}
            className="px-4 py-2 rounded-xl bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors"
          >
            Go to Library
          </button>
        </div>
      </div>
    );
  }

  return <PlaylistDetail playlist={playlist} onClose={() => navigate(-1)} />;
};

export default PlaylistDetailPage;
