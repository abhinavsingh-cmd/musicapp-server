import React, { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { LayoutProvider } from './contexts/LayoutContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AppLayout } from './features/layout/AppLayout';
import { ErrorBoundary } from './components/ErrorBoundary';

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
const ChartsPage = lazy(() => import('./pages/ChartsPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

const PageSpinner = () => (
  <div className="flex-1 flex items-center justify-center py-20">
    <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
  </div>
);

const App: React.FC = () => {
  return (
    <ErrorBoundary level="app">
      <AuthProvider>
        <LayoutProvider>
          <ThemeProvider>
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
                  <Route path="/charts" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><ChartsPage /></Suspense></ErrorBoundary>
                  } />
                  <Route path="/history" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><HistoryPage /></Suspense></ErrorBoundary>
                  } />
                  <Route path="/settings" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><SettingsPage /></Suspense></ErrorBoundary>
                  } />
                  <Route path="*" element={
                    <ErrorBoundary level="page"><Suspense fallback={<PageSpinner />}><NotFoundPage /></Suspense></ErrorBoundary>
                  } />
                </Route>
              </Routes>
            </ThemeProvider>
          </LayoutProvider>
        </AuthProvider>
    </ErrorBoundary>
  );
};

export default App;
