import { memo } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Search, Settings } from 'lucide-react';
import { cn } from '../../utils/cn';

export const MainContent = memo(() => {
  const navigate = useNavigate();
  return (
    <main className="flex-1 overflow-y-auto relative">
      <header className={cn(
        "h-16 liquid-glass border-b border-white/5 flex items-center justify-between px-4 sm:px-6 relative z-20",
        "lg:pl-64"
      )}>
        <div className="flex items-center space-x-3">
          <img src="/logo-icon.svg" alt="MusicApp" className="w-7 h-7 rounded-lg" />
          <h1 className="text-xl font-bold text-gradient hidden sm:block">MusicApp</h1>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => navigate('/search')}
            className="p-2.5 rounded-xl glassmorphism hover:shadow-lg transition-all"
            aria-label="Search"
          >
            <Search className="w-5 h-5 text-gray-300" />
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="p-2.5 rounded-xl glassmorphism hover:shadow-lg transition-all"
            aria-label="Settings"
          >
            <Settings className="w-5 h-5 text-gray-300" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto relative pb-28">
        <Outlet />
      </div>
    </main>
  );
});
MainContent.displayName = 'MainContent';