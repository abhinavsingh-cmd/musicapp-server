import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAudioStore } from '../stores/audioStore';

/**
 * Desktop keyboard shortcuts.
 *
 * Space       → Play / Pause
 * ←           → Seek backward 5 s
 * →           → Seek forward 5 s
 * ↑           → Volume up
 * ↓           → Volume down
 * Ctrl+L      → Toggle lyrics panel
 * Ctrl+K      → Navigate to Search
 * Ctrl+Shift+S → Toggle shuffle
 * Esc         → Close any open panel / modal
 *
 * Shortcuts are ignored while typing in <input>, <textarea>, or contentEditable.
 */
export function useKeyboardShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isEditable =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable);

      if (isEditable) return;

      const {
        togglePlayPause,
        seek,
        progress,
        setVolume,
        volume,
        toggleShuffle,
      } = useAudioStore.getState();

      const ctrl = e.ctrlKey || e.metaKey; // support Cmd on macOS

      switch (e.code) {
        // ---- Playback ----
        case 'Space':
          e.preventDefault();
          togglePlayPause();
          break;

        // ---- Seek ----
        case 'ArrowRight':
          e.preventDefault();
          seek(Math.min(progress + 5, useAudioStore.getState().duration));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seek(Math.max(progress - 5, 0));
          break;

        // ---- Volume ----
        case 'ArrowUp':
          e.preventDefault();
          setVolume(Math.min(volume + 0.05, 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(Math.max(volume - 0.05, 0));
          break;

        // ---- Panels / Navigation (Ctrl combos) ----
        case 'KeyL':
          if (ctrl && !e.shiftKey) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('toggle-lyrics'));
          }
          break;

        case 'KeyK':
          if (ctrl && !e.shiftKey) {
            e.preventDefault();
            navigate('/search');
          }
          break;

        case 'KeyS':
          if (ctrl && e.shiftKey) {
            e.preventDefault();
            toggleShuffle();
          }
          break;

        // ---- Close modals ----
        case 'Escape':
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('close-panels'));
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);
}
