import {defineConfig} from '@playwright/test';
import base from './playwright.row-local.config';
export default defineConfig({...base,testMatch:'**/theme-palettes.spec.ts',outputDir:'./.sonora/test-results/theme-palettes'});
