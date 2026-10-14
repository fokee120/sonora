import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beginDownloadJob, updateDownloadJob, readDownloadJob, validDownloadRequestId } from '../src/server/bridge/DownloadJobs.js';
test('capture progress never invents elapsed time or completes before artifact validation; jobs expire and reject collisions', () => {
  const id = randomUUID(); beginDownloadJob(id, 'session-a');
  assert.equal(readDownloadJob(id, 'session-b'), undefined);
  assert.throws(() => beginDownloadJob(id, 'session-b'), /already in use/);
  updateDownloadJob(id, 'recording', 5, 10);
  assert.equal(readDownloadJob(id, 'session-a')!.progress, 47);
  updateDownloadJob(id, 'recording', 5, 10);
  assert.equal(readDownloadJob(id, 'session-a')!.progress, 47);
  updateDownloadJob(id, 'recording', 10, 10);
  updateDownloadJob(id, 'finalizing');
  assert.equal(readDownloadJob(id, 'session-a')!.progress, 95);
  updateDownloadJob(id, 'cancelled');
  const now = Date.now; try {
    Date.now = () => now() + 120001;
    assert.equal(readDownloadJob(id, 'session-a'), undefined);
  } finally { Date.now = now; }
  assert.equal(validDownloadRequestId('invalid'), false);
  assert.equal(validDownloadRequestId(id + '!'), false);
});
