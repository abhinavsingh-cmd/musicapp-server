import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Plugin } from '@capacitor/core';

export type MediaAction = 'play' | 'pause' | 'next' | 'previous' | 'stop' | 'seek' | 'headset';

export interface MediaActionEvent {
  action: MediaAction;
  position?: number;
}

export interface BackgroundAudioPlugin extends Plugin {
  startService(options: { title: string; artist: string; album?: string }): Promise<{ started: boolean }>;
  stopService(): Promise<void>;
  updateMetadata(options: { title: string; artist: string; album?: string; albumArt?: string }): Promise<void>;
  updatePlaybackState(options: { isPlaying: boolean; position: number; duration?: number }): Promise<void>;
  setShuffle(): Promise<void>;
  setRepeat(): Promise<void>;
  getPlaybackState(): Promise<{ isPlaying: boolean; position: number; duration: number }>;
  requestPermissions(): Promise<{ notifications: string }>;
  playAudioUrl(options: { audioUrl: string }): Promise<{ started: boolean }>;
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
  getPlaybackState: async (): Promise<{ isPlaying: boolean; position: number; duration: number }> => {
    try {
      if (!BackgroundAudio) return { isPlaying: false, position: 0, duration: 0 };
      return await BackgroundAudio.getPlaybackState();
    } catch {
      return { isPlaying: false, position: 0, duration: 0 };
    }
  },
  playAudioUrl: async (options: { audioUrl: string }): Promise<{ started: boolean }> => {
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
