import React, { lazy, Suspense, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { LayoutProvider } from './contexts/LayoutContext';
import { AppLayout } from './features/layout/AppLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SplashScreen } from './components/ui/splash-screen';
import { useAudioStore } from './stores/audioStore';
import { useDownloadsStore } from './stores/downloadsStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { backgroundAudio } from './services/backgroundAudio';
import { logger } from './utils/logger';
import { deferIdle } from './utils/idle';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const DiscoverPage = lazy(() => import('./pages/DiscoverPage'));
const FavoritesPage = lazy(() => import('./pages/FavoritesPage'));
const CreatePlaylistPage = lazy(() => import('./pages/CreatePlaylistPage'));
const CreateAlbumPage = lazy(() => import('./pages/CreateAlbumPage'));
const DownloadsPage = lazy(() => import('./pages/DownloadsPage'));
const PlaylistDetailPage = lazy(() => import('./pages/PlaylistDetailPage'));
const ChartsPage = lazy(() => import('./pages/ChartsPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const DevPage = lazy(() => import('./pages/DevPage'));

const PageSpinner = () => (
  <div className="flex-1 p-6 space-y-4">
    <div className="flex items-center gap-3 mb-6">
      <div className="w-10 h-10 rounded-xl bg-white/5 animate-pulse" />
      <div className="space-y-2">
        <div className="h-5 w-32 rounded bg-white/10 animate-pulse" />
        <div className="h-3 w-48 rounded bg-white/5 animate-pulse" />
      </div>
    </div>
    {Array.from({ length: 8 }).map((_, i) => (
      <div key={i} className="flex items-center gap-4 py-2 animate-pulse" style={{ animationDelay: `${i * 40}ms` }}>
        <div className="w-5 h-4 rounded bg-white/10" />
        <div className="w-10 h-10 rounded-lg bg-white/10" />
        <div className="flex-1 space-y-2">
          <div className="h-4 rounded bg-white/10 w-2/3" />
          <div className="h-3 rounded bg-white/10 w-1/3" />
        </div>
        <div className="w-8 h-4 rounded bg-white/10" />
      </div>
    ))}
  </div>
);

/**
 * Lazy-loaded route with the standard per-page ErrorBoundary + Suspense
 * wrapping. Removes the 15x-repeated boilerplate from the route table below.
 */
function LazyRoute({ element }: { element: React.ReactNode }) {
  return (
    <ErrorBoundary level="page">
      <Suspense fallback={<PageSpinner />}>{element}</Suspense>
    </ErrorBoundary>
  );
}

const App: React.FC = () => {
  useKeyboardShortcuts();

  useEffect(() => {
    // Request notification permission on startup (Android 13+)
    // This ensures the foreground service can show its notification
    backgroundAudio.requestNotificationPermission().catch(() => {});

    // Restore playback state and downloads in background — never blocks render.
    // loadDownloads() MUST run on startup so isDownloaded()/getBlobUrl() work
    // from any page. Without this, downloaded songs appear as non-downloaded
    // after app restart and the app re-requests YouTube unnecessarily.
    deferIdle(() => {
      try {
        useAudioStore.getState().restoreFromPersistence();
      } catch (e) {
        logger.error('Failed to restore playback state:', e);
      }
      try {
        useDownloadsStore.getState().loadDownloads();
      } catch (e) {
        logger.error('Failed to load downloads:', e);
      }
    });
  }, []);

  return (
    <ErrorBoundary level="app">
      <AuthProvider>
        <LayoutProvider>
          <SplashScreen />
          <Routes>
            <Route path="/login" element={<LazyRoute element={<LoginPage />} />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<LazyRoute element={<HomePage />} />} />
              <Route path="/library" element={<LazyRoute element={<LibraryPage />} />} />
              <Route path="/search" element={<LazyRoute element={<SearchPage />} />} />
              <Route path="/discover" element={<LazyRoute element={<DiscoverPage />} />} />
              <Route path="/favorites" element={<LazyRoute element={<FavoritesPage />} />} />
              <Route path="/create-playlist" element={<LazyRoute element={<CreatePlaylistPage />} />} />
              <Route path="/create-album" element={<LazyRoute element={<CreateAlbumPage />} />} />
              <Route path="/downloads" element={<LazyRoute element={<DownloadsPage />} />} />
              <Route path="/playlist/:id" element={<LazyRoute element={<PlaylistDetailPage />} />} />
              <Route path="/charts" element={<LazyRoute element={<ChartsPage />} />} />
              <Route path="/history" element={<LazyRoute element={<HistoryPage />} />} />
              <Route path="/settings" element={<LazyRoute element={<SettingsPage />} />} />
              <Route path="/dev" element={<LazyRoute element={<DevPage />} />} />
              <Route path="*" element={<LazyRoute element={<NotFoundPage />} />} />
            </Route>
          </Routes>
        </LayoutProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
};

export default App;
