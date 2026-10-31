import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './.sonora/test-results/pwa',
  testMatch: '**/pwa-offline.spec.ts',
  workers: 1,
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4174', headless: true },
  webServer: {
    command: 'node scripts/start-server.mjs',
    env: { PORT: '4174' },
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } }],
});
