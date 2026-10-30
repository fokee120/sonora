import {defineConfig} from '@playwright/test';
import base from './playwright.row-local.config';
export default defineConfig({...base,testMatch:'**/player-preferences.spec.ts',outputDir:'.sonora/test-results/player-preferences'});
