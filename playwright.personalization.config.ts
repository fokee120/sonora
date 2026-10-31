import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({...base,outputDir:'./.sonora/test-results/personalization',testMatch:'**/personalization-discovery.spec.ts',projects:[{name:'chromium',use:{browserName:'chromium'}},{name:'webkit',use:{browserName:'webkit'}}]});
