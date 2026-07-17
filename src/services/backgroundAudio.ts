import { registerPlugin } from '@capacitor/core';

export interface BackgroundAudioPlugin {
  startService(options: { title: string; artist: string }): Promise<{ started: boolean }>;
  stopService(): Promise<void>;
}

const BackgroundAudio = registerPlugin<BackgroundAudioPlugin>('BackgroundAudio');

export const backgroundAudio = {
  startService: async (options: { title: string; artist: string }): Promise<{ started: boolean }> => {
    try {
      return await BackgroundAudio.startService(options);
    } catch {
      return { started: false };
    }
  },
  stopService: async (): Promise<void> => {
    try {
      await BackgroundAudio.stopService();
    } catch {
      // Plugin not available on web
    }
  }
};
