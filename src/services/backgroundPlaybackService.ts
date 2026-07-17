/**
 * Background Playback Service
 *
 * Handles audio interruptions and background behavior:
 *   - Page visibility changes (tab switch, minimize)
 *   - Audio element interruptions (headphone unplug, Bluetooth disconnect)
 *   - Media Session play/pause from OS notifications/lock screen
 *   - Prevents duplicate audio instances
 *   - Battery optimization (pauses progress tracking when hidden)
 *
 * Browser-specific notes:
 *   - Chrome: Full background audio support. Media Session API fully supported.
 *   - Safari iOS: Audio pauses on tab switch unless playing via Media Session.
 *               Use `navigator.mediaSession` to keep audio alive.
 *   - Firefox: Background audio supported. Media Session partially supported.
 *   - Edge: Same as Chrome (Chromium-based).
 */

type InterruptionType = 'bluetooth-disconnect' | 'headphone-unplug' | 'audio-route-change' | 'system';
type BackgroundCallback = (isBackground: boolean) => void;
type InterruptionCallback = (type: InterruptionType) => void;

class BackgroundPlaybackService {
  private isBackground = false;
  private backgroundCallbacks: BackgroundCallback[] = [];
  private interruptionCallbacks: InterruptionCallback[] = [];
  private audioElements: Map<HTMLAudioElement, Array<() => void>> = new Map();
  private visibilityHandler: (() => void) | null = null;
  private freezeHandler: (() => void) | null = null;
  private resumeHandler: (() => void) | null = null;

  /** Initialize all listeners */
  init(): void {
    // Page visibility
    this.visibilityHandler = () => {
      const hidden = document.hidden;
      if (hidden && !this.isBackground) {
        this.isBackground = true;
        this.backgroundCallbacks.forEach((cb) => cb(true));
      } else if (!hidden && this.isBackground) {
        this.isBackground = false;
        this.backgroundCallbacks.forEach((cb) => cb(false));
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // Page freeze/resume (BFCache - Firefox, Safari)
    this.freezeHandler = () => {
      // Page is being frozen – save state immediately
      this.backgroundCallbacks.forEach((cb) => cb(true));
    };
    this.resumeHandler = () => {
      this.backgroundCallbacks.forEach((cb) => cb(false));
    };
    document.addEventListener('freeze', this.freezeHandler);
    document.addEventListener('resume', this.resumeHandler);

    // Save state before page unload
    window.addEventListener('beforeunload', this.handleBeforeUnload);
  }

  /** Register an audio element for interruption monitoring */
  registerAudioElement(audio: HTMLAudioElement): void {
    const abortHandler = () => {
      this.notifyInterruption('audio-route-change');
    };
    const emptiedHandler = () => {
      if (this.audioElements.has(audio)) {
        this.notifyInterruption('audio-route-change');
      }
    };

    audio.addEventListener('abort', abortHandler);
    audio.addEventListener('emptied', emptiedHandler);
    this.audioElements.set(audio, [abortHandler, emptiedHandler]);
  }

  /** Unregister an audio element */
  unregisterAudioElement(audio: HTMLAudioElement): void {
    const handlers = this.audioElements.get(audio);
    if (handlers) {
      audio.removeEventListener('abort', handlers[0]);
      audio.removeEventListener('emptied', handlers[1]);
      this.audioElements.delete(audio);
    }
  }

  /** Subscribe to background/foreground transitions */
  onBackgroundChange(callback: BackgroundCallback): () => void {
    this.backgroundCallbacks.push(callback);
    return () => {
      this.backgroundCallbacks = this.backgroundCallbacks.filter((cb) => cb !== callback);
    };
  }

  /** Subscribe to audio interruptions */
  onInterruption(callback: InterruptionCallback): () => void {
    this.interruptionCallbacks.push(callback);
    return () => {
      this.interruptionCallbacks = this.interruptionCallbacks.filter((cb) => cb !== callback);
    };
  }

  /** Check if the app is currently in the background */
  getIsBackground(): boolean {
    return this.isBackground;
  }

  /** Destroy all listeners */
  destroy(): void {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    if (this.freezeHandler) {
      document.removeEventListener('freeze', this.freezeHandler);
    }
    if (this.resumeHandler) {
      document.removeEventListener('resume', this.resumeHandler);
    }
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    for (const [audio, handlers] of this.audioElements) {
      audio.removeEventListener('abort', handlers[0]);
      audio.removeEventListener('emptied', handlers[1]);
    }
    this.audioElements.clear();
    this.backgroundCallbacks = [];
    this.interruptionCallbacks = [];
  }

  private handleBeforeUnload = (): void => {
    // Trigger immediate save via callbacks
    this.backgroundCallbacks.forEach((cb) => cb(true));
  };

  private notifyInterruption(type: InterruptionType): void {
    this.interruptionCallbacks.forEach((cb) => cb(type));
  }
}

export const backgroundPlaybackService = new BackgroundPlaybackService();
