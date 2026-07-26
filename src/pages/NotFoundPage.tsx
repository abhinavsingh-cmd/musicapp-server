import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoBack } from '../hooks/useGoBack';
import { Home, Search, ArrowLeft, Music } from 'lucide-react';

const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();
  const goBack = useGoBack();

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="max-w-lg w-full text-center space-y-8">
        <div className="relative inline-block">
          <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-[var(--color-accent)]/20 to-purple-500/20 flex items-center justify-center">
            <Music className="w-10 h-10 text-[var(--color-accent)]" />
          </div>
          <div className="absolute -top-2 -right-2 w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
            <span className="text-red-400 text-lg font-bold">?</span>
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-6xl font-black text-white/10">404</h1>
          <h2 className="text-2xl font-bold text-white -mt-4">Page not found</h2>
          <p className="text-gray-400 text-sm max-w-sm mx-auto">
            The page you're looking for doesn't exist or has been moved. Let's get you back to the music.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={goBack}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Go back
          </button>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--color-accent)] hover:brightness-110 text-white text-sm font-medium transition-all"
          >
            <Home className="w-4 h-4" />
            Home
          </button>
          <button
            onClick={() => navigate('/search')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-colors"
          >
            <Search className="w-4 h-4" />
            Search
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotFoundPage;
