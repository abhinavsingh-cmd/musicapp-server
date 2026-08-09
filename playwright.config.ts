import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    headless: true,
    launchOptions: {
      // Media autoplay must not require a user gesture: the app hands off the
      // click gesture into async extraction, so play() is called well after.
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
});
