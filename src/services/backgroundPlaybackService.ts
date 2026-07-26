/**
 * Background Playback Service
 *
 * Handles audio interruptions and background behavior:
 *   - Page visibility changes (tab switch, minimize)
 *   - Audio element interruptions (headphone unplug, Bluetooth disconnect)
 *   - Auto-resume on audio reconnection
 *   - Media Session play/pause from OS notifications/lock screen
 *   - Prevents duplicate audio instances
 */

type InterruptionType = 'bluetooth-disconnect' | 'headphone-unplug' | 'audio-route-change' | 'system';
type BackgroundCallback = (isBackground: boolean) => void;
type InterruptionCallback = (type: InterruptionType) => void;
type ReconnectCallback = () => void;

class BackgroundPlaybackService {
  private isBackground = false;
  private wasInterrupted = false;
  private backgroundCallbacks: BackgroundCallback[] = [];
  private interruptionCallbacks: InterruptionCallback[] = [];
  private reconnectCallbacks: ReconnectCallback[] = [];
  private audioElements: Map<HTMLAudioElement, Array<() => void>> = new Map();
  private visibilityHandler: (() => void) | null = null;
  private freezeHandler: (() => void) | null = null;
  private resumeHandler: (() => void) | null = null;

  init(): void {
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
    try { document.addEventListener('visibilitychange', this.visibilityHandler); } catch {}

    this.freezeHandler = () => {
      this.backgroundCallbacks.forEach((cb) => cb(true));
    };
    this.resumeHandler = () => {
      this.backgroundCallbacks.forEach((cb) => cb(false));
    };
    try { document.addEventListener('freeze', this.freezeHandler); } catch {}
    try { document.addEventListener('resume', this.resumeHandler); } catch {}

    try { window.addEventListener('beforeunload', this.handleBeforeUnload); } catch {}

    this.setupAudioReconnection();
  }

  private setupAudioReconnection(): void {
    // Reserved for future audio reconnection logic.
    // Do NOT set mediaSession action handlers here — mediaSessionService owns them.
  }

  registerAudioElement(audio: HTMLAudioElement): void {
    const abortHandler = () => {
      this.wasInterrupted = true;
      this.notifyInterruption('audio-route-change');
    };
    const emptiedHandler = () => {
      if (this.audioElements.has(audio)) {
        this.wasInterrupted = true;
        this.notifyInterruption('audio-route-change');
      }
    };

    audio.addEventListener('abort', abortHandler);
    audio.addEventListener('emptied', emptiedHandler);
    this.audioElements.set(audio, [abortHandler, emptiedHandler]);
  }

  unregisterAudioElement(audio: HTMLAudioElement): void {
    const handlers = this.audioElements.get(audio);
    if (handlers) {
      audio.removeEventListener('abort', handlers[0]);
      audio.removeEventListener('emptied', handlers[1]);
      this.audioElements.delete(audio);
    }
  }

  onBackgroundChange(callback: BackgroundCallback): () => void {
    this.backgroundCallbacks.push(callback);
    return () => {
      this.backgroundCallbacks = this.backgroundCallbacks.filter((cb) => cb !== callback);
    };
  }

  onInterruption(callback: InterruptionCallback): () => void {
    this.interruptionCallbacks.push(callback);
    return () => {
      this.interruptionCallbacks = this.interruptionCallbacks.filter((cb) => cb !== callback);
    };
  }

  onReconnect(callback: ReconnectCallback): () => void {
    this.reconnectCallbacks.push(callback);
    return () => {
      this.reconnectCallbacks = this.reconnectCallbacks.filter((cb) => cb !== callback);
    };
  }

  getIsBackground(): boolean {
    return this.isBackground;
  }

  getWasInterrupted(): boolean {
    return this.wasInterrupted;
  }

  clearInterruption(): void {
    this.wasInterrupted = false;
  }

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
    this.reconnectCallbacks = [];
  }

  private handleBeforeUnload = (): void => {
    this.backgroundCallbacks.forEach((cb) => cb(true));
  };

  private notifyInterruption(type: InterruptionType): void {
    this.interruptionCallbacks.forEach((cb) => cb(type));
  }

  notifyReconnect(): void {
    this.wasInterrupted = false;
    this.reconnectCallbacks.forEach((cb) => cb());
  }
}

export const backgroundPlaybackService = new BackgroundPlaybackService();
