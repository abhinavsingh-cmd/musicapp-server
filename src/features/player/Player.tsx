import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PlayerControls } from './controls/PlayerControls';
import { ProgressBar } from './controls/ProgressBar';
import { SongInfo } from './controls/SongInfo';
import { LyricsDisplay } from './controls/LyricsDisplay';
import { EqualizerUI } from './controls/EqualizerUI';
import { QueuePanel } from './QueuePanel';
import { cn } from '../../utils/cn';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic2, X, Sliders, ListMusic, ChevronUp, ChevronDown } from 'lucide-react';

interface PlayerProps {
  className?: string;
}

export const Player: React.FC<PlayerProps> = ({ className }) => {
  const [showLyrics, setShowLyrics] = useState(false);
  const [showEqualizer, setShowEqualizer] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isExpanded, setIsExpanded] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!playerRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        if (!playerRef.current) { rafRef.current = 0; return; }
        const rect = playerRef.current.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && 
            e.clientY >= rect.top && e.clientY <= rect.bottom) {
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          setMousePosition({
            x: ((e.clientX - centerX) / rect.width) * 100,
            y: ((e.clientY - centerY) / rect.height) * 100,
          });
        }
        rafRef.current = 0;
      });
    };

    const handleMouseLeave = () => {
      setMousePosition({ x: 0, y: 0 });
    };

    window.addEventListener('mousemove', handleMouseMove);
    playerRef.current.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      playerRef.current?.removeEventListener('mouseleave', handleMouseLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
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
    const handleClosePanels = () => {
      setShowLyrics(false);
      setShowEqualizer(false);
      setShowQueue(false);
    };

    window.addEventListener('toggle-lyrics', handleToggleLyrics);
    window.addEventListener('close-panels', handleClosePanels);
    return () => {
      window.removeEventListener('toggle-lyrics', handleToggleLyrics);
      window.removeEventListener('close-panels', handleClosePanels);
    };
  }, [togglePanel]);

  return (
    <>
      <div id="yt-player-container" className="fixed -left-[9999px] -top-[9999px] pointer-events-none opacity-0" style={{ width: 360, height: 200 }} />

      <AnimatePresence>
        {showQueue && (
          <motion.div
            initial={{ opacity: 0, x: 20, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed bottom-28 right-4 w-96 h-[500px] rounded-3xl overflow-hidden z-40 liquid-glass flex flex-col lg:bottom-32 lg:right-4"
            style={{
              boxShadow: '0 25px 80px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1)'
            }}
          >
            <div className="flex items-center justify-between p-4 border-b border-white/5 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                  <ListMusic size={14} className="text-white" />
                </div>
                <span className="text-white font-semibold">Queue</span>
              </div>
              <motion.button
                onClick={() => setShowQueue(false)}
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/20 transition-all"
              >
                <X size={16} />
              </motion.button>
            </div>
            <div className="flex-1 overflow-hidden">
              <QueuePanel />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showLyrics && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed bottom-28 right-4 w-80 rounded-3xl overflow-hidden z-40 liquid-glass lg:bottom-32 lg:right-4"
            style={{
              boxShadow: '0 25px 80px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1)'
            }}
          >
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                  <Mic2 size={14} className="text-white" />
                </div>
                <span className="text-white font-semibold">Lyrics</span>
              </div>
              <motion.button
                onClick={() => setShowLyrics(false)}
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/20 transition-all"
              >
                <X size={16} />
              </motion.button>
            </div>
            <LyricsDisplay />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showEqualizer && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed bottom-28 right-4 w-96 rounded-3xl overflow-hidden z-40 liquid-glass lg:bottom-32 lg:right-4"
            style={{
              boxShadow: '0 25px 80px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1)'
            }}
          >
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                  <Sliders size={14} className="text-white" />
                </div>
                <span className="text-white font-semibold">Equalizer</span>
              </div>
              <motion.button
                onClick={() => setShowEqualizer(false)}
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/20 transition-all"
              >
                <X size={16} />
              </motion.button>
            </div>
            <div className="p-4">
              <EqualizerUI />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        ref={playerRef}
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50",
          "liquid-glass",
          "lg:left-64",
          className
        )}
      >
        <div
          className="absolute inset-0 pointer-events-none opacity-30"
          style={{
            background: `radial-gradient(600px circle at ${mousePosition.x + 50}% ${mousePosition.y + 50}%, rgba(139, 92, 246, 0.15), transparent 40%)`,
            willChange: 'background',
          }}
        />

        <ProgressBar />

        <div className="flex items-center px-4 gap-4 relative z-10" style={{ height: '64px' }}>
          <SongInfo className="flex-1 min-w-0" />

          <div className="flex items-center gap-2">
            <motion.button
              onClick={() => togglePanel('queue')}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center transition-all liquid-glass",
                showQueue
                  ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-glow"
                  : "text-gray-400 hover:text-white"
              )}
              title="Queue"
            >
              <ListMusic size={18} />
            </motion.button>

            <motion.button
              onClick={() => togglePanel('lyrics')}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center transition-all liquid-glass",
                showLyrics
                  ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-glow"
                  : "text-gray-400 hover:text-white"
              )}
              title="Lyrics"
            >
              <Mic2 size={18} />
            </motion.button>

            <motion.button
              onClick={() => togglePanel('equalizer')}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center transition-all liquid-glass",
                showEqualizer
                  ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-glow"
                  : "text-gray-400 hover:text-white"
              )}
              title="Equalizer"
            >
              <Sliders size={18} />
            </motion.button>
          </div>

          <PlayerControls className="flex-shrink-0" />
        </div>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="lg:hidden pb-safe overflow-y-auto"
              style={{ maxHeight: 'calc(100vh - 100px)' }}
            >
              <div className="px-4 pb-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">Now Playing</h3>
                  <motion.button
                    onClick={() => setIsExpanded(false)}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-all"
                  >
                    <ChevronDown size={20} />
                  </motion.button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <motion.button
                    onClick={() => togglePanel('lyrics')}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      "p-4 rounded-2xl liquid-glass text-center transition-all",
                      showLyrics ? "bg-violet-500/20 border border-violet-500/30" : ""
                    )}
                  >
                    <Mic2 size={24} className="mx-auto mb-2 text-white" />
                    <span className="text-sm font-medium">Lyrics</span>
                  </motion.button>
                  <motion.button
                    onClick={() => togglePanel('equalizer')}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      "p-4 rounded-2xl liquid-glass text-center transition-all",
                      showEqualizer ? "bg-violet-500/20 border border-violet-500/30" : ""
                    )}
                  >
                    <Sliders size={24} className="mx-auto mb-2 text-white" />
                    <span className="text-sm font-medium">Equalizer</span>
                  </motion.button>
                  <motion.button
                    onClick={() => togglePanel('queue')}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      "p-4 rounded-2xl liquid-glass text-center transition-all",
                      showQueue ? "bg-violet-500/20 border border-violet-500/30" : ""
                    )}
                  >
                    <ListMusic size={24} className="mx-auto mb-2 text-white" />
                    <span className="text-sm font-medium">Queue</span>
                  </motion.button>
                </div>
                {showLyrics && <LyricsDisplay />}
                {showEqualizer && <div className="liquid-glass rounded-2xl p-4"><EqualizerUI /></div>}
                {showQueue && <div className="liquid-glass rounded-2xl p-4 max-h-96 overflow-auto"><QueuePanel /></div>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          onClick={() => setIsExpanded(true)}
          className="lg:hidden w-full h-2 bg-gradient-to-r from-transparent via-violet-500/30 to-transparent rounded-t-2xl"
          whileHover={{ scaleY: 2 }}
          whileTap={{ scaleY: 0.5 }}
          aria-label="Expand player"
        >
          <ChevronUp size={16} className="mx-auto text-violet-400" />
        </motion.button>
      </div>
    </>
  );
};