import {defineConfig} from '@playwright/test';
import base from './playwright.row-local.config';
export default defineConfig({...base,testMatch:'**/recap.spec.ts',outputDir:'.sonora/test-results/recap'});
