import { useEffect } from 'react';
import { useAudioStore } from '../stores/audioStore';
import { audioService } from '../services/audioServiceInstance';

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      const state = useAudioStore.getState();

      switch (e.code) {
        case 'Space': {
          e.preventDefault();
          if (state.currentSong) state.togglePlayPause();
          break;
        }
        case 'ArrowRight': {
          if (e.shiftKey) {
            e.preventDefault();
            if (state.currentSong) {
              const t = audioService.getCurrentTime();
              const d = audioService.getDuration();
              state.seek(Math.min(t + 10, d));
            }
          }
          break;
        }
        case 'ArrowLeft': {
          if (e.shiftKey) {
            e.preventDefault();
            if (state.currentSong) {
              const t = audioService.getCurrentTime();
              state.seek(Math.max(t - 10, 0));
            }
          }
          break;
        }
        case 'KeyN': {
          if (e.shiftKey) {
            e.preventDefault();
            state.nextSong();
          }
          break;
        }
        case 'KeyP': {
          if (e.shiftKey) {
            e.preventDefault();
            state.previousSong();
          }
          break;
        }
        case 'KeyL': {
          if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
            if (state.currentSong) {
              e.preventDefault();
              state.toggleFavorite(state.currentSong.id);
            }
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
