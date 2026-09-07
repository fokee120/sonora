import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', headless: true, channel: process.env.PLAYWRIGHT_CHANNEL, launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
