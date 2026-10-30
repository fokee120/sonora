import {defineConfig} from '@playwright/test';
import base from './playwright.config';
export default defineConfig({...base,testMatch:['**/row-local.spec.ts','**/import-modal.spec.ts'],projects:[{name:'chromium',use:{browserName:'chromium'}},{name:'webkit',use:{browserName:'webkit'}}],outputDir:'./.sonora/test-results/row-local',use:{...base.use,baseURL:'http://127.0.0.1:4175'},webServer:{command:'npx vite --host 127.0.0.1 --port 4175 --strictPort',url:'http://127.0.0.1:4175',reuseExistingServer:true}});
