/**
 * Media Session API Service
 *
 * Provides lock-screen / notification-area / OS media controls:
 *   - Album artwork
 *   - Song title / artist / album
 *   - Play, Pause, Next, Previous
 *   - Seek Forward / Seek Backward
 *
 * Works on Chrome Android, Safari iOS (limited), Chrome Desktop, Edge.
 * Gracefully no-ops when the API is unavailable.
 */

import { Song } from '../types/music';

interface MediaSessionCallbacks {
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeekForward: () => void;
  onSeekBackward: () => void;
  onStop: () => void;
}

class MediaSessionService {
  private callbacks: MediaSessionCallbacks | null = null;
  private supported = typeof navigator !== 'undefined' && 'mediaSession' in navigator;

  init(callbacks: MediaSessionCallbacks): void {
    this.callbacks = callbacks;
    if (!this.supported) return;

    const handlers: [string, (() => void) | null][] = [
      ['play', () => callbacks.onPlay()],
      ['pause', () => callbacks.onPause()],
      ['nexttrack', () => callbacks.onNext()],
      ['previoustrack', () => callbacks.onPrevious()],
      ['seekforward', () => callbacks.onSeekForward()],
      ['seekbackward', () => callbacks.onSeekBackward()],
      ['stop', () => callbacks.onStop()],
    ];

    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler);
      } catch {
        // Some browsers throw for unsupported actions (e.g. Safari iOS)
      }
    }
  }

  /** Update the metadata shown in OS media controls */
  updateMetadata(song: Song): void {
    if (!this.supported) return;

    const artwork: MediaImage[] = song.coverArt
      ? [
          { src: song.coverArt, sizes: '512x512', type: 'image/jpeg' },
          { src: song.coverArt, sizes: '256x256', type: 'image/jpeg' },
          { src: song.coverArt, sizes: '128x128', type: 'image/jpeg' },
        ]
      : [];

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
        album: song.album || 'MusicApp',
        artwork,
      });
    } catch {
      // Fallback for browsers that reject large artwork
      if (artwork.length > 0) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: song.title,
            artist: song.artist,
            album: song.album || 'MusicApp',
            artwork: [artwork[0]],
          });
        } catch {
          // give up silently
        }
      }
    }
  }

  /** Update the playback state shown in OS controls */
  updatePlaybackState(isPlaying: boolean, currentTime: number, duration: number): void {
    if (!this.supported) return;

    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      navigator.mediaSession.setPositionState?.({
        duration: duration || 0,
        playbackRate: 1,
        position: Math.max(0, Math.min(currentTime, duration || 0)),
      });
    } catch {
      // some browsers may not support setPositionState
    }
  }

  /** Update the supported action handlers (e.g. enable/disable next/prev based on queue) */
  updateActions(hasNext: boolean, hasPrevious: boolean): void {
    if (!this.supported || !this.callbacks) return;

    try {
      navigator.mediaSession.setActionHandler('nexttrack', hasNext ? () => this.callbacks!.onNext() : null);
      navigator.mediaSession.setActionHandler('previoustrack', hasPrevious ? () => this.callbacks!.onPrevious() : null);
    } catch {
      // ignore unsupported actions
    }
  }

  destroy(): void {
    if (!this.supported) return;
    try {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
      navigator.mediaSession.setActionHandler('previoustrack', null);
      navigator.mediaSession.setActionHandler('seekforward', null);
      navigator.mediaSession.setActionHandler('seekbackward', null);
      navigator.mediaSession.setActionHandler('stop', null);
    } catch {
      // ignore
    }
  }
}

export const mediaSessionService = new MediaSessionService();
