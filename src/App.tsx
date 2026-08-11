import React, { lazy, Suspense, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { LayoutProvider } from './contexts/LayoutContext';
import { AppLayout } from './features/layout/AppLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAudioStore } from './stores/audioStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

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

const App: React.FC = () => {
  useKeyboardShortcuts();

  useEffect(() => {
    // Restore playback state in background — never blocks render
    const defer = typeof requestIdleCallback === 'function'
      ? requestIdleCallback
      : (cb: IdleRequestCallback) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
    defer(() => {
      try {
        useAudioStore.getState().restoreFromPersistence();
      } catch (e) {
        console.error('Failed to restore playback state:', e);
      }
    });
  }, []);

  return (
    <ErrorBoundary level="app">
      <AuthProvider>
        <LayoutProvider>
              <Routes>
                <Route path="/login" element={
                  <ErrorBoundary level="page">
                    <Suspense fallback={<PageSpinner />}>
                      <LoginPage />
                    </Suspense>
                  </ErrorBoundary>
                } />
                <Route element={<AppLayout />}>
                  <Route path="/" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><HomePage /></Suspense></ErrorBoundary>
                  } />
                  <Route path="/library" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><LibraryPage /></Suspense></ErrorBoundary>
                  } />
                  <Route path="/search" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><SearchPage /></Suspense></ErrorBoundary>
                  } />
                  <Route path="/discover" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><DiscoverPage /></Suspense></ErrorBoundary>
                  } />
                  <Route path="/favorites" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><FavoritesPage /></Suspense></ErrorBoundary>
                  } />
                  <Route path="/create-playlist" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><CreatePlaylistPage /></Suspense></ErrorBoundary>
                  } />
                  <Route path="/create-album" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><CreateAlbumPage /></Suspense></ErrorBoundary>
                  } />
                  <Route path="/downloads" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><DownloadsPage /></Suspense></ErrorBoundary>
                  } />
                  <Route path="/playlist/:id" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><PlaylistDetailPage /></Suspense></ErrorBoundary>
                  } />
                  <Route path="/charts" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><ChartsPage /></Suspense></ErrorBoundary>
                  } />
                  <Route path="/history" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><HistoryPage /></Suspense></ErrorBoundary>
                  } />
                  <Route path="/settings" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><SettingsPage /></Suspense></ErrorBoundary>
                  } />
                  <Route path="/dev" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><DevPage /></Suspense></ErrorBoundary>
                  } />
                  <Route path="*" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><NotFoundPage /></Suspense></ErrorBoundary>
                  } />
                </Route>
              </Routes>
          </LayoutProvider>
        </AuthProvider>
      </ErrorBoundary>
  );
};

export default App;
