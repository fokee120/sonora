import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({ ...base, outputDir: './.sonora/test-results/design', testMatch: '**/design-experience.spec.ts', projects: [{ name: 'chromium', use: { browserName: 'chromium' } }, { name: 'webkit', use: { browserName: 'webkit' } }] });
