import React, { memo } from 'react';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { Sidebar } from './Sidebar';
import { MainContent } from './MainContent';
import { RightPlayer } from './RightPlayer';
import { AlbumArtBackground } from '../player/AlbumArtBackground';
import { OfflineIndicator } from '../offline/OfflineIndicator';
import { useLayout } from '../../contexts/LayoutContext';
import { cn } from '../../utils/cn';

export const AppLayout: React.FC = memo(() => {
  const { sidebarOpen } = useLayout();

  return (
    <div className="h-screen bg-[var(--color-bg)] flex overflow-hidden relative">
      <div className="fixed inset-0 pointer-events-none z-0" style={{ pointerEvents: 'none' }}>
        <div className="absolute inset-0 bg-mesh" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[var(--color-accent)]/5 rounded-full blur-3xl float-slow" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-fuchsia-500/5 rounded-full blur-3xl float-slow" style={{ animationDelay: '-3s' }} />
      </div>
      
      <AlbumArtBackground />
      <OfflineIndicator />
      
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
        <RightPlayer />
      </ErrorBoundary>
    </div>
  );
});
AppLayout.displayName = 'AppLayout';