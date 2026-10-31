import {defineConfig} from '@playwright/test';
import base from './playwright.mobile.config';
export default defineConfig({...base,testMatch:'**/theme-styles.spec.ts',outputDir:'./.sonora/test-results/themes'});
