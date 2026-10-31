import {defineConfig} from '@playwright/test';
import base from './playwright.mobile.config';
export default defineConfig({...base,testMatch:'**/playlist-local.spec.ts',outputDir:'./.sonora/test-results/playlist-local'});
