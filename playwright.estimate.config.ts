import {defineConfig} from '@playwright/test';
import base from './playwright.row-local.config';
export default defineConfig({...base,testMatch:'**/playlist-local.spec.ts',outputDir:'./.sonora/test-results/auto-estimates'});
