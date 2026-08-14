import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import { PlayerControls } from './controls/PlayerControls';
import { ProgressBar } from './controls/ProgressBar';
import { SongInfo } from './controls/SongInfo';
import { LyricsDisplay } from './controls/LyricsDisplay';
import { EqualizerUI } from './controls/EqualizerUI';
import { QueuePanel } from './QueuePanel';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { cn } from '../../utils/cn';
import { Mic2, X, Sliders, ListMusic, ChevronUp, ChevronDown, AlertCircle, RefreshCw } from 'lucide-react';
import { useAudioStore } from '../../stores/audioStore';
import { usePlayerLayout } from '../../hooks/usePlayerLayout';

interface PlayerProps {
  className?: string;
}

/**
 * Panel shell — wraps Queue/Lyrics/Equalizer in a consistent modal container.
 *
 * Desktop: floating card above the player bar, centered or right-aligned.
 * Mobile (< lg): full-width bottom sheet with safe-area padding.
 *
 * z-index hierarchy (intentional):
 *   z-[55]  backdrop (dims background, catches clicks)
 *   z-[60]  panel card (above player bar at z-50)
 */
const PanelShell: React.FC<{
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Extra classes for the inner content area (e.g. padding, overflow) */
  contentClassName?: string;
  /** Whether the content itself handles scrolling (default: true) */
  scrollable?: boolean;
}> = ({ title, icon, onClose, children, contentClassName, scrollable = true }) => (
  <>
    {/* ── Backdrop ── */}
    <div
      className="fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm transition-opacity"
      onClick={onClose}
      aria-hidden="true"
    />

    {/* ── Panel card ── */}
    <div
      className={cn(
        // Positioning — bottom-sheet on mobile (above player bar), floating card on desktop
        "fixed z-[60] left-0 right-0 bottom-[var(--player-h,72px)]",
        "lg:left-auto lg:right-4 lg:bottom-[calc(var(--player-h,72px)+2rem)] lg:w-96",
        // Shape & appearance
        "bg-[#1a1a2e] border border-white/10",
        "rounded-t-3xl lg:rounded-3xl",
        // Layout
        "flex flex-col",
        // Height: fill viewport on mobile (minus player bar), constrained on desktop
        "max-h-[calc(85vh-var(--player-h,72px))] lg:max-h-[min(70vh,600px)]",
        // Safe-area on mobile
        "pb-safe",
      )}
      style={{
        boxShadow: '0 25px 80px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08)',
      }}
      role="dialog"
      aria-label={title}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
            {icon}
          </div>
          <span className="text-white font-semibold">{title}</span>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/20 transition-all active:scale-90"
          aria-label={`Close ${title}`}
        >
          <X size={16} />
        </button>
      </div>

      {/* ── Content ── */}
      <div className={cn(
        scrollable ? "flex-1 overflow-y-auto" : "flex-1 overflow-hidden",
        contentClassName,
      )}>
        {children}
      </div>
    </div>
  </>
);

export const Player: React.FC<PlayerProps> = memo(({ className }) => {
  const [showLyrics, setShowLyrics] = useState(false);
  const [showEqualizer, setShowEqualizer] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const error = useAudioStore((s) => s.error);
  const currentSong = useAudioStore((s) => s.currentSong);
  const retry = useAudioStore((s) => s.retry);
  const playerBarRef = useRef<HTMLDivElement>(null);
  usePlayerLayout(playerBarRef);

  const handleRetry = useCallback(() => {
    if (currentSong) {
      retry();
    }
  }, [currentSong, retry]);

  const closeAll = useCallback(() => {
    setShowLyrics(false);
    setShowEqualizer(false);
    setShowQueue(false);
  }, []);

  const togglePanel = useCallback((panel: 'lyrics' | 'equalizer' | 'queue') => {
    if (panel === 'lyrics') {
      setShowLyrics((v) => !v);
      setShowEqualizer(false);
      setShowQueue(false);
    } else if (panel === 'equalizer') {
      setShowEqualizer((v) => !v);
      setShowLyrics(false);
      setShowQueue(false);
    } else {
      setShowQueue((v) => !v);
      setShowLyrics(false);
      setShowEqualizer(false);
    }
  }, []);

  useEffect(() => {
    const handleToggleLyrics = () => togglePanel('lyrics');
    const handleClosePanels = closeAll;

    window.addEventListener('toggle-lyrics', handleToggleLyrics);
    window.addEventListener('close-panels', handleClosePanels);
    return () => {
      window.removeEventListener('toggle-lyrics', handleToggleLyrics);
      window.removeEventListener('close-panels', handleClosePanels);
    };
  }, [togglePanel, closeAll]);

  // Lock body scroll when any panel is open
  const hasOpenPanel = showQueue || showLyrics || showEqualizer;
  useEffect(() => {
    if (hasOpenPanel) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [hasOpenPanel]);

  return (
    <>
      {/* ── Queue panel ── */}
      {showQueue && (
        <PanelShell
          title="Queue"
          icon={<ListMusic size={14} className="text-white" />}
          onClose={closeAll}
          scrollable={false}
        >
          <QueuePanel />
        </PanelShell>
      )}

      {/* ── Lyrics panel ── */}
      {showLyrics && (
        <PanelShell
          title="Lyrics"
          icon={<Mic2 size={14} className="text-white" />}
          onClose={closeAll}
          scrollable={false}
        >
          <LyricsDisplay />
        </PanelShell>
      )}

      {/* ── Equalizer panel ── */}
      {showEqualizer && (
        <PanelShell
          title="Equalizer"
          icon={<Sliders size={14} className="text-white" />}
          onClose={closeAll}
          contentClassName="p-4"
          scrollable={false}
        >
          <ErrorBoundary level="section">
            <EqualizerUI />
          </ErrorBoundary>
        </PanelShell>
      )}

      {/* ── Player bar ── */}
      <div
        ref={playerBarRef}
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50",
          "bg-[#121220] border-t border-white/10",
          "lg:left-64",
          className
        )}
      >
        {error && (
          <div className="bg-red-500/10 border-t border-red-500/20 px-4 py-2">
            <div className="flex items-center gap-2 text-red-400 text-xs">
              <AlertCircle size={14} />
              <span className="flex-1 truncate">{error}</span>
              <button
                onClick={handleRetry}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 transition-colors text-red-300 font-medium"
              >
                <RefreshCw size={12} />
                Retry
              </button>
            </div>
          </div>
        )}

        <ProgressBar />

        <div className="flex items-center px-4 gap-4 relative z-10" style={{ height: '64px' }}>
          <SongInfo className="flex-1 min-w-0" />

          <div className="flex items-center gap-2">
            <button
              onClick={() => togglePanel('queue')}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 bg-white/10 hover:bg-white/20",
                showQueue
                  ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-glow"
                  : "text-gray-400 hover:text-white"
              )}
              title="Queue"
            >
              <ListMusic size={18} />
            </button>

            <button
              onClick={() => togglePanel('lyrics')}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 bg-white/10 hover:bg-white/20",
                showLyrics
                  ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-glow"
                  : "text-gray-400 hover:text-white"
              )}
              title="Lyrics"
            >
              <Mic2 size={18} />
            </button>

            <button
              onClick={() => togglePanel('equalizer')}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 bg-white/10 hover:bg-white/20",
                showEqualizer
                  ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-glow"
                  : "text-gray-400 hover:text-white"
              )}
              title="Equalizer"
            >
              <Sliders size={18} />
            </button>
          </div>

          <PlayerControls className="flex-shrink-0" />
        </div>

        {/* Mobile expanded view */}
        {isExpanded && (
          <div className="lg:hidden pb-safe overflow-y-auto" style={{ maxHeight: 'calc(100vh - 100px)' }}>
            <div className="px-4 pb-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Now Playing</h3>
                <button
                  onClick={() => setIsExpanded(false)}
                  className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-all active:scale-90"
                >
                  <ChevronDown size={20} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => togglePanel('lyrics')}
                  className={cn(
                    "p-4 rounded-2xl bg-white/10 text-center transition-all active:scale-95",
                    showLyrics ? "bg-violet-500/20 border border-violet-500/30" : ""
                  )}
                >
                  <Mic2 size={24} className="mx-auto mb-2 text-white" />
                  <span className="text-sm font-medium">Lyrics</span>
                </button>
                <button
                  onClick={() => togglePanel('equalizer')}
                  className={cn(
                    "p-4 rounded-2xl bg-white/10 text-center transition-all active:scale-95",
                    showEqualizer ? "bg-violet-500/20 border border-violet-500/30" : ""
                  )}
                >
                  <Sliders size={24} className="mx-auto mb-2 text-white" />
                  <span className="text-sm font-medium">Equalizer</span>
                </button>
                <button
                  onClick={() => togglePanel('queue')}
                  className={cn(
                    "p-4 rounded-2xl bg-white/10 text-center transition-all active:scale-95",
                    showQueue ? "bg-violet-500/20 border border-violet-500/30" : ""
                  )}
                >
                  <ListMusic size={24} className="mx-auto mb-2 text-white" />
                  <span className="text-sm font-medium">Queue</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={() => setIsExpanded(true)}
          className="lg:hidden w-full h-2 bg-gradient-to-r from-transparent via-violet-500/30 to-transparent rounded-t-2xl"
          aria-label="Expand player"
        >
          <ChevronUp size={16} className="mx-auto text-violet-400" />
        </button>
      </div>
    </>
  );
});
Player.displayName = 'Player';
