import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { useAudioStore } from '../../stores/audioStore';
import { useReducedMotion } from 'framer-motion';

/**
 * Background album art — a subtle, blurred backdrop behind the UI.
 *
 * Performance: full-screen `blur()` + CSS animation is a GPU compositor
 * killer on low-end Android WebViews. We use a static image with NO blur/animation
 * on Android, and only enable blur+animation on capable devices.
 */
export const AlbumArtBackground: React.FC = memo(() => {
  const currentSong = useAudioStore((s) => s.currentSong);
  const shouldReduceMotion = useReducedMotion();
  // Disable background entirely on Android Capacitor (WebView)
  const isNative = typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform();
  
  if (isNative) return null;

  const [active, setActive] = useState<'a' | 'b'>('a');
  const prevSongRef = useRef<string | null>(null);
  const prevCoverUrlRef = useRef<string | null>(null);

  // Crossfade between two image slots on song change
  useEffect(() => {
    if (!currentSong) return;
    if (currentSong.id === prevSongRef.current) return;

    const currentCover = currentSong.coverArt || '';
    if (prevCoverUrlRef.current && prevCoverUrlRef.current !== currentCover) {
      setActive((prev) => (prev === 'a' ? 'b' : 'a'));
    }
    prevSongRef.current = currentSong.id;
    prevCoverUrlRef.current = currentCover;
  }, [currentSong, currentSong?.id, currentSong?.coverArt]);

  const coverUrl = currentSong?.coverArt || '';
  const prevCoverUrl = prevCoverUrlRef.current;

  // Only enable blur/zoom on desktop, not mobile WebView
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const transitionMs = shouldReduceMotion || isMobile ? 0 : 800;
  const baseImageStyle: React.CSSProperties = useMemo(() => ({
    filter: isMobile ? 'brightness(0.5)' : 'blur(4px) brightness(0.45) saturate(120%)',
    willChange: 'transform',
  }), [isMobile]);

  // Use CSS background animation for the slow zoom — GPU-composited,
  // never triggers layout or paint. Disable on mobile.
  const zoomStyle: React.CSSProperties = useMemo(() => ({
    ...baseImageStyle,
    animation: (shouldReduceMotion || isMobile) ? 'none' : 'album-zoom-bg 12s ease-in-out infinite alternate',
  }), [baseImageStyle, shouldReduceMotion, isMobile]);

  const slotAOpacity = active === 'a' ? 1 : 0;
  const slotBOpacity = active === 'b' ? 1 : 0;

  if (!coverUrl && !prevCoverUrl) return null;

  return (
    <div
      className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
      aria-hidden="true"
    >
      <div
        className="absolute inset-0"
        style={{
          opacity: slotAOpacity,
          transition: `opacity ${transitionMs}ms ease-in-out`,
          willChange: 'opacity',
        }}
      >
        {coverUrl && active === 'a' && (
          <img src={coverUrl} alt="" decoding="async" className="absolute inset-0 w-full h-full object-cover" style={zoomStyle} />
        )}
        {prevCoverUrl && active === 'b' && (
          <img src={prevCoverUrl} alt="" decoding="async" className="absolute inset-0 w-full h-full object-cover" style={zoomStyle} />
        )}
      </div>

      <div
        className="absolute inset-0"
        style={{
          opacity: slotBOpacity,
          transition: `opacity ${transitionMs}ms ease-in-out`,
          willChange: 'opacity',
        }}
      >
        {prevCoverUrl && active === 'a' && (
          <img src={prevCoverUrl} alt="" decoding="async" className="absolute inset-0 w-full h-full object-cover" style={zoomStyle} />
        )}
        {coverUrl && active === 'b' && (
          <img src={coverUrl} alt="" decoding="async" className="absolute inset-0 w-full h-full object-cover" style={zoomStyle} />
        )}
      </div>

      <div className="absolute inset-0 bg-black/40" />
    </div>
  );
});
AlbumArtBackground.displayName = 'AlbumArtBackground';