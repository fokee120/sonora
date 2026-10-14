import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'download-progress.spec.ts', workers: 1,
  outputDir: '../test-results/download-progress-isolated',
  use: { baseURL: 'http://127.0.0.1:4175', headless: true },
  webServer: { command: 'npx vite --host 127.0.0.1 --port 4175 --strictPort', url: 'http://127.0.0.1:4175', reuseExistingServer: false, cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') },
});
