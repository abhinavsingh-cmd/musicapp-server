import { memo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { useAuth } from '../../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home,
  Search,
  Library,
  Music,
  Heart,
  Plus,
  LogOut,
  User,
  Download,
  TrendingUp,
  Clock,
  Settings,
  X,
} from 'lucide-react';
import { useLayout } from '../../contexts/LayoutContext';

interface SidebarProps {
  className?: string;
  isOpen?: boolean;
  onClose?: () => void;
}

const routePreloadMap: Record<string, () => Promise<unknown>> = {
  '/': () => import('../../pages/HomePage'),
  '/search': () => import('../../pages/SearchPage'),
  '/library': () => import('../../pages/LibraryPage'),
  '/discover': () => import('../../pages/DiscoverPage'),
  '/favorites': () => import('../../pages/FavoritesPage'),
  '/charts': () => import('../../pages/ChartsPage'),
  '/history': () => import('../../pages/HistoryPage'),
  '/downloads': () => import('../../pages/DownloadsPage'),
  '/settings': () => import('../../pages/SettingsPage'),
  '/create-playlist': () => import('../../pages/CreatePlaylistPage'),
  '/create-album': () => import('../../pages/CreateAlbumPage'),
};

const preloaded = new Set<string>();

const navItems = [
  { icon: Home, label: 'Home', path: '/' },
  { icon: Search, label: 'Search', path: '/search' },
  { icon: Library, label: 'Your Library', path: '/library' },
  { icon: Music, label: 'Discover', path: '/discover' },
  { icon: Heart, label: 'Favorites', path: '/favorites' },
  { icon: TrendingUp, label: 'Charts', path: '/charts' },
  { icon: Clock, label: 'History', path: '/history' },
  { icon: Download, label: 'Downloads', path: '/downloads' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

const createItems = [
  { icon: Plus, label: 'Create Playlist', path: '/create-playlist' },
  { icon: Plus, label: 'New Album', path: '/create-album' },
];

const NavItem = memo(function NavItem({ item, isActive, onClose }: { 
  item: typeof navItems[0]; 
  isActive: boolean;
  onClose?: () => void;
}) {
  const Icon = item.icon;
  
  const handlePreload = () => {
    if (!preloaded.has(item.path)) {
      preloaded.add(item.path);
      routePreloadMap[item.path]?.();
    }
  };

  return (
    <div key={item.path}>
      <Link
        to={item.path}
        onClick={onClose}
        onMouseEnter={handlePreload}
        className={cn(
          "flex items-center space-x-3 px-3 py-2.5 rounded-xl transition-[color,background-color] duration-200 group relative overflow-hidden",
          isActive
            ? "text-[var(--color-text)] font-semibold bg-white/5"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        )}
      >
        {isActive && (
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full transition-[opacity] duration-200"
            style={{ background: 'linear-gradient(to bottom, var(--color-accent), var(--color-accent-dark))' }}
          />
        )}
        
        <Icon
          size={20}
          className={cn(
            "relative z-10 transition-[color,transform] duration-200",
            isActive
              ? "text-[var(--color-accent)]"
              : "text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] group-hover:scale-110"
          )}
        />
        <span className="relative z-10 font-medium">{item.label}</span>
      </Link>
    </div>
  );
});
NavItem.displayName = 'NavItem';

const CreateItem = memo(({ item, onClose }: { item: typeof createItems[0]; onClose?: () => void }) => (
  <Link
    key={item.path}
    to={item.path}
    onClick={onClose}
    className="flex items-center space-x-3 px-3 py-2 rounded-xl transition-[color] duration-300 text-[var(--color-text-muted)] hover:text-[var(--color-text)] group"
  >
    <item.icon size={20} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] group-hover:scale-110 transition-[color,transform]" />
    <span className="font-medium">{item.label}</span>
  </Link>
));
CreateItem.displayName = 'CreateItem';

const UserProfile = memo(function UserProfile({ user, logout, onClose }: { 
  user: { name: string; avatar: string; plan: string };
  logout: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="space-y-3">
      <Link
        to="/settings"
        onClick={onClose}
        className="flex items-center space-x-3 px-3 py-2 rounded-xl bg-white/10 transition-all duration-300 hover:bg-white/15"
      >
        <motion.img
          whileHover={{ scale: 1.1 }}
          src={user.avatar}
          alt={user.name}
          className="w-9 h-9 rounded-full object-cover ring-2 ring-[var(--color-accent)]/30"
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-white truncate text-sm">{user.name}</div>
          <div className="text-xs text-[var(--color-accent)] truncate font-medium">
            {user.plan === 'free' ? 'Free Plan' : user.plan === 'premium' ? 'Premium' : 'Pro'}
          </div>
        </div>
      </Link>
      <motion.button
        onClick={() => { logout(); onClose?.(); }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-[var(--color-text-muted)] hover:bg-red-500/10 hover:text-red-400 transition-all duration-300"
      >
        <LogOut size={20} className="text-[var(--color-text-muted)]" />
        <span className="font-medium">Log Out</span>
      </motion.button>
    </div>
  );
});

const GuestProfile = memo(function GuestProfile({ onClose }: { onClose?: () => void }) {
  return (
    <Link
      to="/login"
      onClick={onClose}
      className="flex items-center space-x-3 px-3 py-2 rounded-xl glass-button text-white transition-all duration-300"
    >
      <User size={20} />
      <span className="font-medium">Sign In</span>
    </Link>
  );
});

export const Sidebar = memo(({ className, isOpen = true, onClose }: SidebarProps) => {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { closeSidebar, breakpoint } = useLayout();

  const handleClose = () => {
    onClose?.();
    if (breakpoint !== 'desktop') {
      closeSidebar();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={false}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -280, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className={cn(
            "w-64 h-screen sticky top-0 flex flex-col overflow-hidden flex-shrink-0",
            "bg-[#121220] border-r border-white/10",
            className
          )}
        >
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-purple-500/10 to-transparent" />
            <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-purple-500/5 to-transparent" />
          </div>

          <div className="lg:hidden p-3 flex justify-end">
            <motion.button
              onClick={handleClose}
              whileHover={{ scale: 1.1, rotate: 90 }}
              whileTap={{ scale: 0.9 }}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-all"
              aria-label="Close sidebar"
            >
              <X size={20} />
            </motion.button>
          </div>

          <div className="space-y-6 pt-6 relative z-10">
            <motion.div
              className="flex items-center space-x-3 px-6 py-2"
              whileHover={{ scale: 1.02 }}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
            >
              <motion.img
                src="/logo-icon.svg"
                alt="MusicApp"
                className="w-10 h-10 rounded-2xl"
                whileHover={{ rotate: 360, scale: 1.1 }}
                transition={{ type: 'spring', stiffness: 300 }}
              />
              <h1 className="text-xl font-bold text-white">MusicApp</h1>
            </motion.div>

            <nav className="space-y-1 px-3">
              {navItems.map((item) => (
                <NavItem 
                  key={item.path} 
                  item={item} 
                  isActive={location.pathname === item.path}
                  onClose={handleClose}
                />
              ))}
            </nav>

            <div className="pt-4">
              <h2 className="px-6 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-2">
                Create
              </h2>
              <div className="space-y-1 px-3">
                {createItems.map((item) => (
                  <CreateItem key={item.path} item={item} onClose={handleClose} />
                ))}
              </div>
            </div>
          </div>

          <div className="mt-auto pt-4 pb-6 px-3 border-t border-white/5 relative z-10">
            {user ? (
              <UserProfile user={user} logout={logout} onClose={handleClose} />
            ) : (
              <GuestProfile onClose={handleClose} />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
Sidebar.displayName = 'Sidebar';