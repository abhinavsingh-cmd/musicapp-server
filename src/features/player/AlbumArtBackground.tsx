import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAudioStore } from '../../stores/audioStore';
import { useReducedMotion } from 'framer-motion';

export const AlbumArtBackground: React.FC = () => {
  const currentSong = useAudioStore((s) => s.currentSong);
  const shouldReduceMotion = useReducedMotion();
  const [active, setActive] = useState<'a' | 'b'>('a');
  const prevSongRef = useRef<string | null>(null);
  const prevCoverUrlRef = useRef<string | null>(null);

  // Crossfade between two image slots on song change
  useEffect(() => {
    if (!currentSong) return;
    if (currentSong.id === prevSongRef.current) return;
    
    // Store the previous cover URL before switching
    const currentCover = currentSong.coverArt || '';
    if (prevCoverUrlRef.current && prevCoverUrlRef.current !== currentCover) {
      setActive((prev) => (prev === 'a' ? 'b' : 'a'));
    }
    prevSongRef.current = currentSong.id;
    prevCoverUrlRef.current = currentCover;
  }, [currentSong?.id, currentSong?.coverArt]);

  const coverUrl = currentSong?.coverArt || '';
  const prevCoverUrl = prevCoverUrlRef.current;

  const transitionDuration = shouldReduceMotion ? '0ms' : '1200ms';
  const zoomDuration = shouldReduceMotion ? '0ms' : '8000ms';

  const slotAStyle = useMemo(() => ({
    opacity: active === 'a' ? 1 : 0,
    transitionDuration,
    transitionTimingFunction: 'ease-in-out',
  }), [active, transitionDuration]);

  const slotBStyle = useMemo(() => ({
    opacity: active === 'b' ? 1 : 0,
    transitionDuration,
    transitionTimingFunction: 'ease-in-out',
  }), [active, transitionDuration]);

  const imageStyle = useMemo(() => ({
    filter: 'blur(80px) saturate(150%) brightness(0.4)',
    transform: 'scale(1.1)',
    animation: shouldReduceMotion ? 'none' : `album-zoom ${zoomDuration} ease-in-out infinite alternate`,
  }), [shouldReduceMotion, zoomDuration]);

  return (
    <div
      className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
      aria-hidden="true"
    >
      {/* Image slot A - shows current cover when active='a', previous when active='b' */}
      <div
        className="absolute inset-0 transition-opacity"
        style={slotAStyle}
      >
        {coverUrl && active === 'a' && (
          <img
            src={coverUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={imageStyle}
          />
        )}
        {prevCoverUrl && active === 'b' && (
          <img
            src={prevCoverUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={imageStyle}
          />
        )}
      </div>

      {/* Image slot B - shows previous cover when active='a', current when active='b' */}
      <div
        className="absolute inset-0 transition-opacity"
        style={slotBStyle}
      >
        {prevCoverUrl && active === 'a' && (
          <img
            src={prevCoverUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={imageStyle}
          />
        )}
        {coverUrl && active === 'b' && (
          <img
            src={coverUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={imageStyle}
          />
        )}
      </div>

      {/* Dark overlay for readability */}
      <div className="absolute inset-0 bg-black/40" />
    </div>
  );
};