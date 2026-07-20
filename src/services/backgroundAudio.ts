import { registerPlugin } from '@capacitor/core';

export interface BackgroundAudioPlugin {
  startService(options: { title: string; artist: string }): Promise<{ started: boolean }>;
  stopService(): Promise<void>;
}

let BackgroundAudio: BackgroundAudioPlugin | null = null;
try {
  BackgroundAudio = registerPlugin<BackgroundAudioPlugin>('BackgroundAudio');
} catch {
  // Plugin registration failed — not in Capacitor context
}

export const backgroundAudio = {
  startService: async (options: { title: string; artist: string }): Promise<{ started: boolean }> => {
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
  }
};
