import {defineConfig} from '@playwright/test';import base from './playwright.row-local.config';
export default defineConfig({...base,testMatch:['**/lyrics-cloud-queue.spec.ts','**/cloud-devices.spec.ts','**/queue-priority.spec.ts'],outputDir:'.sonora/test-results/lyrics-cloud-queue'});
