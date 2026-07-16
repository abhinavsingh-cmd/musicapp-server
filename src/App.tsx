import React, { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { AudioProvider } from './contexts/AudioContext';
import { LayoutProvider } from './contexts/LayoutContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AppLayout } from './features/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';

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

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AudioProvider>
        <LayoutProvider>
          <ThemeProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<AppLayout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/library" element={<LibraryPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/discover" element={<DiscoverPage />} />
                <Route path="/favorites" element={<FavoritesPage />} />
                <Route path="/create-playlist" element={<CreatePlaylistPage />} />
                <Route path="/create-album" element={<CreateAlbumPage />} />
                <Route path="/downloads" element={<DownloadsPage />} />
                <Route path="/charts" element={<ChartsPage />} />
                <Route path="/history" element={<HistoryPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ThemeProvider>
        </LayoutProvider>
      </AudioProvider>
    </AuthProvider>
  );
};

export default App;