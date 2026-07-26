import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.abhinav.musicapp',
  appName: 'music-app',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
