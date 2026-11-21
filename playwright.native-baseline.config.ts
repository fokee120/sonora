import {defineConfig} from '@playwright/test';
import base from './playwright.row-local.config';
export default defineConfig({...base,testMatch:['tests/native-baseline.spec.ts']});
