import { memo, Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Search, Settings } from 'lucide-react';
import { cn } from '../../utils/cn';

const PageFallback = memo(() => (
  <div className="flex-1 flex items-center justify-center py-20">
    <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
  </div>
));
PageFallback.displayName = 'PageFallback';

export const MainContent = memo(() => {
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
            onClick={() => window.location.href = '/search'}
            className="p-2.5 rounded-xl glassmorphism hover:shadow-lg transition-all"
            aria-label="Search"
          >
            <Search className="w-5 h-5 text-gray-300" />
          </button>
          <button
            onClick={() => window.location.href = '/settings'}
            className="p-2.5 rounded-xl glassmorphism hover:shadow-lg transition-all"
            aria-label="Settings"
          >
            <Settings className="w-5 h-5 text-gray-300" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto relative">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </div>
    </main>
  );
});
MainContent.displayName = 'MainContent';