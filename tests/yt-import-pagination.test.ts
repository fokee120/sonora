import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import routes from '../src/server/import/importRoutes.js';
const row = (i: number) => ({ musicResponsiveListItemRenderer: { playlistItemData: { videoId: String(i).padStart(11, '0') }, flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Song ' + i }] } } }, { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Artist' }] } } }] } });
test('YouTube endpoint follows continuation tokens beyond the first 100 rows', async () => { const original = globalThis.fetch; const calls: any[] = []; globalThis.fetch = (async (url: any, options: any) => { if (!String(url).includes('youtubei/v1/browse'))
    return original(url, options); const body = JSON.parse(options.body); calls.push(body); const payload = body.continuation ? { continuationContents: { musicPlaylistShelfContinuation: { contents: Array.from({ length: 53 }, (_, i) => row(i + 100)) } } } : { header: { musicDetailHeaderRenderer: { title: { runs: [{ text: 'All songs' }] } } }, contents: { musicPlaylistShelfRenderer: { contents: Array.from({ length: 100 }, (_, i) => row(i)), continuations: [{ nextContinuationData: { continuation: 'page-2' } }] } } }; return Response.json(payload); }) as any; const app = express(); app.use(express.json()); app.use(routes); const server = app.listen(0, '127.0.0.1'); try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const port = (server.address() as any).port;
    const response = await original(`http://127.0.0.1:${port}/api/import/ytmusic`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'PLtest' }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.tracks.length, 153);
    assert.equal(result.title, 'All songs');
    assert.equal(calls[1].continuation, 'page-2');
}
finally {
    globalThis.fetch = original;
    await new Promise<void>(resolve => server.close(() => resolve()));
} });
