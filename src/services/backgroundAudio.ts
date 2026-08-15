import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Plugin } from '@capacitor/core';

export type MediaAction = 'play' | 'pause' | 'next' | 'previous' | 'stop' | 'seek' | 'headset' | 'ended' | 'error';

export interface MediaActionEvent {
  action: MediaAction;
  /** Seek positions are reported in MILLISECONDS by the native MediaSession. */
  position?: number;
  /** Native playback-session generation that produced this event. Lets the JS
   *  layer drop stale events (a late 'ended' for an old track). */
  generation?: number;
}

export interface NativePlayOptions {
  audioUrl: string;
  title?: string;
  artist?: string;
  album?: string;
  albumArt?: string;
  /** Resume offset in MILLISECONDS applied by the native player once prepared. */
  startPositionMs?: number;
  volume?: number;
}

export interface NativePlaybackState {
  isPlaying: boolean;
  /** Position in MILLISECONDS. */
  position: number;
  /** Duration in MILLISECONDS. */
  duration: number;
  /** True while the native MediaPlayer owns playback (vs. a WebView engine). */
  nativeActive?: boolean;
  isBuffering?: boolean;
  /** True when a track completed while JS was disconnected — the JS layer
   *  must continue the queue and then acknowledge via acknowledgeEnded(). */
  endedPending?: boolean;
  /** Native playback-session generation of the current session. */
  generation?: number;
  url?: string;
  title?: string;
  artist?: string;
}

export interface BackgroundAudioPlugin extends Plugin {
  startService(options: { title: string; artist: string; album?: string }): Promise<{ started: boolean }>;
  stopService(): Promise<void>;
  updateMetadata(options: { title: string; artist: string; album?: string; albumArt?: string }): Promise<void>;
  updatePlaybackState(options: { isPlaying: boolean; position: number; duration?: number }): Promise<void>;
  setShuffle(): Promise<void>;
  setRepeat(): Promise<void>;
  getPlaybackState(): Promise<NativePlaybackState>;
  /** Consume the pending-ended flag after the JS layer resumed queue duty. */
  acknowledgeEnded(): Promise<void>;
  requestPermissions(): Promise<{ notifications: string }>;
  playAudioUrl(options: NativePlayOptions): Promise<{ started: boolean; generation?: number }>;
  pauseAudio(): Promise<void>;
  resumeAudio(): Promise<void>;
  stopAudio(): Promise<void>;
  seekAudio(options: { position: number }): Promise<void>;
  setVolume(options: { volume: number }): Promise<void>;
  addListener(
    eventName: 'mediaAction',
    listenerFunc: (event: MediaActionEvent) => void,
  ): Promise<PluginListenerHandle>;
}

let BackgroundAudio: BackgroundAudioPlugin | null = null;
try {
  BackgroundAudio = registerPlugin<BackgroundAudioPlugin>('BackgroundAudio');
} catch {
  // Plugin registration failed — not in Capacitor context
}

export const backgroundAudio = {
  /** Request notification permission (Android 13+). Should be called on app start. */
  requestNotificationPermission: async (): Promise<void> => {
    try {
      if (!BackgroundAudio) return;
      await BackgroundAudio.requestPermissions();
    } catch {
      // ignore — permission may not be needed or already granted
    }
  },

  startService: async (options: { title: string; artist: string; album?: string }): Promise<{ started: boolean }> => {
    try {
      if (!BackgroundAudio) return { started: false };
      return await BackgroundAudio.startService(options);
    } catch {
      return { started: false };
    }
  },
  stopService: async (): Promise<void> => {
    try {
      if (!BackgroundAudio) return;
      await BackgroundAudio.stopService();
    } catch {
      // Plugin not available on web
    }
  },
  updateMetadata: async (options: { title: string; artist: string; album?: string; albumArt?: string }): Promise<void> => {
    try {
      if (!BackgroundAudio) return;
      await BackgroundAudio.updateMetadata(options);
    } catch {
      // ignore
    }
  },
  updatePlaybackState: async (options: { isPlaying: boolean; position: number; duration?: number }): Promise<void> => {
    try {
      if (!BackgroundAudio) return;
      await BackgroundAudio.updatePlaybackState(options);
    } catch {
      // ignore
    }
  },
  setShuffle: async (): Promise<void> => {
    try {
      if (!BackgroundAudio) return;
      await BackgroundAudio.setShuffle();
    } catch {
      // ignore
    }
  },
  setRepeat: async (): Promise<void> => {
    try {
      if (!BackgroundAudio) return;
      await BackgroundAudio.setRepeat();
    } catch {
      // ignore
    }
  },
  getPlaybackState: async (): Promise<NativePlaybackState> => {
    try {
      if (!BackgroundAudio) return { isPlaying: false, position: 0, duration: 0, nativeActive: false, endedPending: false };
      return await BackgroundAudio.getPlaybackState();
    } catch {
      return { isPlaying: false, position: 0, duration: 0, nativeActive: false, endedPending: false };
    }
  },
  acknowledgeEnded: async (): Promise<void> => {
    try {
      if (!BackgroundAudio) return;
      await BackgroundAudio.acknowledgeEnded();
    } catch {
      // ignore — flag simply stays set and is re-consumed on next check
    }
  },
  playAudioUrl: async (options: NativePlayOptions): Promise<{ started: boolean; generation?: number }> => {
    try {
      if (!BackgroundAudio) return { started: false };
      return await BackgroundAudio.playAudioUrl(options);
    } catch {
      return { started: false };
    }
  },
  pauseAudio: async (): Promise<void> => {
    try {
      if (!BackgroundAudio) return;
      await BackgroundAudio.pauseAudio();
    } catch {
      // ignore
    }
  },
  resumeAudio: async (): Promise<void> => {
    try {
      if (!BackgroundAudio) return;
      await BackgroundAudio.resumeAudio();
    } catch {
      // ignore
    }
  },
  stopAudio: async (): Promise<void> => {
    try {
      if (!BackgroundAudio) return;
      await BackgroundAudio.stopAudio();
    } catch {
      // ignore
    }
  },
  seekAudio: async (options: { position: number }): Promise<void> => {
    try {
      if (!BackgroundAudio) return;
      await BackgroundAudio.seekAudio(options);
    } catch {
      // ignore
    }
  },
  setVolume: async (options: { volume: number }): Promise<void> => {
    try {
      if (!BackgroundAudio) return;
      await BackgroundAudio.setVolume(options);
    } catch {
      // ignore
    }
  },
  onMediaAction: async (listener: (event: MediaActionEvent) => void): Promise<PluginListenerHandle | null> => {
    try {
      if (!BackgroundAudio) return null;
      return await BackgroundAudio.addListener('mediaAction', listener);
    } catch {
      return null;
    }
  },
};
