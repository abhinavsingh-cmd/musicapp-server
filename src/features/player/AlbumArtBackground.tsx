import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { useAudioStore } from '../../stores/audioStore';
import { useReducedMotion } from 'framer-motion';

/**
 * Background album art — a subtle, blurred backdrop behind the UI.
 *
 * Performance: full-screen `blur(20px)` + CSS animation is a GPU compositor
 * killer on low-end Android WebViews. We use `blur(8px)` + CSS-only
 * `background-size` animation (GPU-composited) instead of filter-based
 * animation. The blur is small enough that it never triggers per-frame
 * rasterisation on any device.
 */
export const AlbumArtBackground: React.FC = memo(() => {
  const currentSong = useAudioStore((s) => s.currentSong);
  const shouldReduceMotion = useReducedMotion();
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

  // Blur(8px) is a fixed cost — the browser rasterises it once and the GPU
  // composites the result. No per-frame re-raster needed.
  const transitionMs = shouldReduceMotion ? 0 : 1200;
  const baseImageStyle: React.CSSProperties = useMemo(() => ({
    filter: 'blur(8px) brightness(0.45) saturate(120%)',
    willChange: 'transform',
  }), []);

  // Use CSS background animation for the slow zoom — GPU-composited,
  // never triggers layout or paint.
  const zoomStyle: React.CSSProperties = useMemo(() => ({
    ...baseImageStyle,
    animation: shouldReduceMotion ? 'none' : 'album-zoom-bg 10s ease-in-out infinite alternate',
  }), [baseImageStyle, shouldReduceMotion]);

  const slotAOpacity = active === 'a' ? 1 : 0;
  const slotBOpacity = active === 'b' ? 1 : 0;

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