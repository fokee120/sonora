import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = (path: string) => readFileSync(path, 'utf8');
test('startup has no local email account gate or authentication API calls', () => {
  assert.doesNotMatch(read('src/App.tsx') + read('src/context/AppContext.tsx'), /AuthModal|authSession|\/api\/auth\//);
  assert.equal(existsSync('api/auth/login.ts'), false);
});
test('server has no cloud bucket credentials, routes, demo arrays or proxy fallbacks', () => {
  assert.doesNotMatch(read('server.ts'), /GCS|gcsProvider|DEMO_|\/api\/storage|\/api\/auth|AUTHORIZED_EMAILS/);
  assert.equal(existsSync('src/server/storage/GCSStorageProvider.ts'), false);
  assert.equal(existsSync('src/server/libraryIndexer.ts'), false);
});
test('settings and dependencies have no removed storage integration', () => {
  assert.doesNotMatch(read('src/views/SettingsView.tsx'), /GCS|GCP_|AUTHORIZED_EMAILS|\/api\/storage|authSession/);
  assert.doesNotMatch(read('src/types/index.ts'), /['"]gcs['"]/);
  for (const path of ['package.json', 'package-lock.json', 'bun.lock']) assert.doesNotMatch(read(path), /@google-cloud\/storage/);
});
test('Drive and YouTube APIs and offline library remain available', () => {
  assert.match(read('server.ts'), /\/api\/drive\/scan/);
  assert.match(read('server.ts'), /app.use\(youtubeApi\)/);
  assert.match(read('src/context/AppContext.tsx'), /getAllTracks|scanGoogleDrive|searchYoutubeMusic/);
});
