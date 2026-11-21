import {defineConfig} from '@playwright/test';
import base from './playwright.row-local.config';
export default defineConfig({...base,testMatch:['**/media-session.spec.ts','**/native-session.spec.ts'],outputDir:'.sonora/test-results/native-session'});
