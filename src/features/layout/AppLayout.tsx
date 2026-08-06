import React, { memo, lazy, Suspense } from 'react';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { Sidebar } from './Sidebar';
import { MainContent } from './MainContent';
import { useLayout } from '../../contexts/LayoutContext';
import { useBackNavigation } from '../../hooks/useBackNavigation';
import { cn } from '../../utils/cn';

const RightPlayer = lazy(() => import('./RightPlayer').then(m => ({ default: m.RightPlayer })));
const AlbumArtBackground = lazy(() => import('../player/AlbumArtBackground').then(m => ({ default: m.AlbumArtBackground })));
const OfflineIndicator = lazy(() => import('../offline/OfflineIndicator').then(m => ({ default: m.OfflineIndicator })));

const PlayerFallback = () => <div className="h-24" />;

export const AppLayout: React.FC = memo(() => {
  const { sidebarOpen } = useLayout();
  useBackNavigation();

  return (
    <div className="h-screen bg-[var(--color-bg)] flex overflow-hidden relative">
      <div className="fixed inset-0 pointer-events-none z-0 bg-mesh" />
      
      <Suspense fallback={null}>
        <AlbumArtBackground />
      </Suspense>
      <Suspense fallback={null}>
        <OfflineIndicator />
      </Suspense>
      
      <ErrorBoundary level="section" fallback={<div className="w-64 bg-[var(--color-surface)] border-r border-[var(--color-border)] h-full" />}>
        <Sidebar isOpen={sidebarOpen} onClose={() => {}} />
      </ErrorBoundary>
      
      <div className={cn(
        "flex-1 flex flex-col overflow-hidden relative z-10 min-w-0 min-h-0",
        "lg:pl-0"
      )}>
        <ErrorBoundary level="section" fallback={<div className="flex-1 flex items-center justify-center text-[var(--color-text-secondary)]">Content unavailable</div>}>
          <MainContent />
        </ErrorBoundary>
      </div>
      
      <ErrorBoundary level="section" fallback={<div className="h-24 bg-[var(--color-surface)] border-t border-[var(--color-border)]" />}>
        <Suspense fallback={<PlayerFallback />}>
          <RightPlayer />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
});
AppLayout.displayName = 'AppLayout';