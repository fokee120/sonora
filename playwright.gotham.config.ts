import {defineConfig} from '@playwright/test';
import base from './playwright.row-local.config';
export default defineConfig({...base,testMatch:['**/theme-styles.spec.ts','**/theme-palettes.spec.ts'],outputDir:'./.sonora/test-results/gotham'});
