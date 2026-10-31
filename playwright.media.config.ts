import { defineConfig } from '@playwright/test';
import base from './playwright.mobile.config';
export default defineConfig({ ...base, testMatch: '**/media-session.spec.ts', outputDir: './.sonora/test-results/media' });
