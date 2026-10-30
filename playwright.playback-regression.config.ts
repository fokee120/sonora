import {defineConfig} from '@playwright/test';
import base from './playwright.row-local.config';
export default defineConfig({...base,testMatch:['**/queue-priority.spec.ts','**/ios-queue.spec.ts','**/player-preferences.spec.ts'],outputDir:'.sonora/test-results/playback-regression'});
