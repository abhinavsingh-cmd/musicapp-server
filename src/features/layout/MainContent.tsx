import { memo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Search, Settings, Menu, Home, Library, Download, Music2 } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useLayout } from '../../contexts/LayoutContext';

const mobileNavItems = [
  { icon: Home, label: 'Home', path: '/' },
  { icon: Library, label: 'Library', path: '/library' },
  { icon: Music2, label: 'Charts', path: '/charts' },
  { icon: Download, label: 'Downloads', path: '/downloads' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

export const MainContent = memo(() => {
  const navigate = useNavigate();
  const location = useLocation();
  const { openSidebar } = useLayout();
  return (
    <main className="flex-1 overflow-y-auto relative">
      <header className={cn(
        "h-16 border-b border-white/10 flex items-center justify-between px-4 sm:px-6 relative z-20",
        "bg-[#121220] lg:pl-64"
      )}>
        <div className="flex items-center space-x-3">
          <button
            onClick={openSidebar}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5 text-white" />
          </button>
          <img src="/logo-icon.svg" alt="MusicApp" className="w-7 h-7 rounded-lg" />
          <h1 className="text-xl font-bold text-white hidden sm:block">MusicApp</h1>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => navigate('/search')}
            className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition-[background-color]"
            aria-label="Search"
          >
            <Search className="w-5 h-5 text-white" />
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition-[background-color]"
            aria-label="Settings"
          >
            <Settings className="w-5 h-5 text-white" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto relative pb-content">
        <Outlet />
      </div>

      <nav className="lg:hidden fixed left-0 right-0 z-50 bg-[#121220] border-t border-white/10 px-2 mobile-nav">
        <div className="flex items-center justify-around h-16">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={cn(
                  "flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-colors min-w-0",
                  isActive
                    ? "text-[var(--color-accent)]"
                    : "text-gray-500 hover:text-gray-300"
                )}
              >
                <Icon size={20} />
                <span className="text-[10px] font-medium truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </main>
  );
});
MainContent.displayName = 'MainContent';