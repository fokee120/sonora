import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Version/27.0 Mobile/15E148 Safari/604.1' });
function wav(seconds: number) {
  const rate = 8000, size = rate * seconds * 2, b = Buffer.alloc(44 + size);
  b.write('RIFF'); b.writeUInt32LE(size + 36, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(size, 40);
  for (let i = 0; i < size / 2; i++) b.writeInt16LE(Math.round(1000 * Math.sin(i * Math.PI * 880 / rate)), 44 + i * 2);
  return b;
}
const tracks = ['abcdefghijk', 'lmnopqrstuv'].map((id, index) => ({ id: `ytm:${id}`, source: 'ytmusic', sourceId: id,
  cloudKey: `ytmusic://${id}`, title: `Queue song ${index}`, artist: 'Fixture', album: 'Fixture', duration: 4, format: 'wav' }));

test('native offline audio advances after EOF on the same iOS player without another tap', async ({ page, context }) => {
  await page.route('**/api/**', route => route.fulfill({ json: { tracks: [], albums: [], artists: [] } }));
  await page.route('**/api/ytmusic/download/**', route => route.fulfill({ body: wav(4), contentType: 'audio/wav' }));
  await page.goto('/');
  await page.evaluate(async tracks => {
    const path = '/src/lib/offline/OfflineManager.ts'; const manager = (await import(path)).offlineManager;
    for (const track of tracks) await manager.downloadTrack(track);
  }, tracks);
  await expect.poll(() => page.evaluate(async tracks => {
    const path = '/src/lib/offline/OfflineManager.ts'; const manager = (await import(path)).offlineManager;
    return tracks.every(track => manager.isTrackDownloaded(track.id));
  }, tracks)).toBe(true);
  await context.setOffline(true);
  await page.evaluate(async tracks => {
    const path = '/src/lib/audio/PlayerEngine.ts'; const engine = (await import(path)).playerEngine;
    (window as any).__queueEngine = engine;
    const dbPath='/src/lib/db.ts';const {dbService}=await import(dbPath);
    await dbService.savePlaylist({id:'native-fixture',title:'Native playlist',trackIds:tracks.map(t=>t.id),createdAt:1,updatedAt:1});
    await engine.playPlaylist('native-fixture',tracks,false);
    (window as any).__firstQueueAudio = document.querySelector('audio[data-sonora-player]');
  }, tracks);
  await expect.poll(() => page.evaluate(() => (window as any).__queueEngine.getState().currentTime)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => { const next=(window as any).__queueEngine.preparedNext; return next && {id:next.id,source:next.source}; })).toEqual({id:tracks[1].id,source:'local'});
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const audio = (window as any).__firstQueueAudio; audio.currentTime = audio.duration - 0.15;
  });
  await expect.poll(() => page.evaluate(() => {
    const state = (window as any).__queueEngine.getState();
    return { id: state.currentTrack?.id, playing: state.isPlaying, source: state.playbackSource, error: state.error };
  })).toEqual({ id: tracks[1].id, playing: true, source: 'local', error: null });
  expect(await page.evaluate(() => document.querySelector('audio[data-sonora-player]') === (window as any).__firstQueueAudio)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__queueEngine.getState().currentTime)).toBeGreaterThan(0);
});

test('lock-screen skip assigns the prevalidated offline song synchronously', async ({ page, context }) => {
  await page.route('**/api/**', route => route.fulfill({ json: { tracks: [], albums: [], artists: [] } }));
  await page.route('**/api/ytmusic/download/**', route => route.fulfill({ body: wav(4), contentType: 'audio/wav' }));
  await page.goto('/');
  await page.evaluate(async tracks => { const path='/src/lib/offline/OfflineManager.ts'; const manager=(await import(path)).offlineManager; for(const track of tracks) await manager.downloadTrack(track); }, tracks);
  await expect.poll(()=>page.evaluate(async tracks=>{const path='/src/lib/offline/OfflineManager.ts';const manager=(await import(path)).offlineManager;return tracks.every(track=>manager.isTrackDownloaded(track.id));},tracks)).toBe(true);
  await context.setOffline(true);
  // Preparing the next download must not create a second verification player.
  await page.evaluate(async tracks => {
    const path='/src/lib/offline/OfflineManager.ts'; const manager=(await import(path)).offlineManager;
    const original=manager.validateLocalAudio.bind(manager);
    manager.validateLocalAudio=async (track, blob, signal) => {
      if (track.id === tracks[1].id) throw new Error('Unexpected second-player validation');
      return original(track, blob, signal);
    };
  }, tracks);
  await page.evaluate(async tracks=>{const path='/src/lib/audio/PlayerEngine.ts';const engine=(await import(path)).playerEngine;(window as any).__queueEngine=engine;await engine.playTrack(tracks[0],tracks);},tracks);
  await expect.poll(()=>page.evaluate(()=>{const next=(window as any).__queueEngine.preparedNext;return next && {id:next.id,source:next.source};})).toEqual({id:tracks[1].id,source:'local'});
  const result=await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});const engine=(window as any).__queueEngine;const expected=engine.preparedNext.url;engine.next();return {assigned:engine.sourceAssigned,src:(document.querySelector('audio[data-sonora-player]') as HTMLAudioElement).src,expected,source:engine.getState().playbackSource};});
  expect(result.assigned).toBe(true);expect(result.src).toBe(result.expected);expect(result.source).toBe('local');
  await expect.poll(()=>page.evaluate(()=>{const state=(window as any).__queueEngine.getState();return state.currentTrack?.id==='ytm:lmnopqrstuv'&&state.isPlaying&&state.currentTime>0;})).toBe(true);
  const back=await page.evaluate(()=>{const engine=(window as any).__queueEngine;const expected=engine.previousBuffered.url;engine.previous(true);return {assigned:engine.sourceAssigned,src:(document.querySelector('audio[data-sonora-player]') as HTMLAudioElement).src,expected,source:engine.getState().playbackSource};});
  expect(back.assigned).toBe(true);expect(back.src).toBe(back.expected);expect(back.source).toBe('local');
  await expect.poll(()=>page.evaluate(()=>(window as any).__queueEngine.getState().currentTrack?.id)).toBe(tracks[0].id);
});


test('next streamed song is prepared before locking and needs no new stream request at EOF', async ({ page, context }) => {
  let streams = 0;
  await page.route('**/api/**', route => route.fulfill({ json: { tracks: [], albums: [], artists: [] } }));
  await page.route('**/api/ytmusic/stream/**', route => { streams++; return route.fulfill({ body: wav(4), contentType: 'audio/wav' }); });
  await page.route('**/api/ytmusic/download/**', route => route.fulfill({ body: wav(4), contentType: 'audio/wav' }));
  await page.goto('/');
  await page.evaluate(async tracks => {
    const path = '/src/lib/audio/PlayerEngine.ts'; const engine = (await import(path)).playerEngine;
    (window as any).__queueEngine = engine;
    await engine.playTrack(tracks[0], tracks);
    (window as any).__firstQueueAudio = document.querySelector('audio[data-sonora-player]');
  }, tracks);
  await expect.poll(() => page.evaluate(() => (window as any).__queueEngine.preparedNext?.id)).toBe(tracks[1].id);
  // Network unavailable at handoff: the next song must still decode and play.
  await context.setOffline(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const audio = (window as any).__firstQueueAudio; audio.currentTime = audio.duration - 0.15;
  });
  await expect.poll(() => page.evaluate(() => {
    const state = (window as any).__queueEngine.getState();
    return state.currentTrack?.id === 'ytm:lmnopqrstuv' && state.isPlaying && state.currentTime > 0;
  })).toBe(true);
  expect(streams).toBe(1);
  const result = await page.evaluate(async () => {
    const engine = (window as any).__queueEngine;
    engine.seek(2);
    const path = '/src/lib/offline/OfflineManager.ts';
    return { same: document.querySelector('audio[data-sonora-player]') === (window as any).__firstQueueAudio,
      downloaded: (await import(path)).offlineManager.isTrackDownloaded('ytm:lmnopqrstuv'),
      src: (window as any).__firstQueueAudio.src, position: engine.getState().currentTime };
  });
  expect(result.same).toBe(true); expect(result.downloaded).toBe(false);
  expect(result.src).toMatch(/^blob:/); expect(result.position).toBeCloseTo(2, 1);
});


test('a failed next-stream preparation leaves the current song playing and permits normal skipping', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: { tracks: [], albums: [], artists: [] } }));
  await page.route('**/api/ytmusic/stream/**', route => route.fulfill({ body: wav(4), contentType: 'audio/wav' }));
  await page.route('**/api/ytmusic/download/**', route => route.fulfill({ status: 502, json: { error: 'Source unavailable' } }));
  await page.goto('/');
  await page.evaluate(async tracks => {
    const path = '/src/lib/audio/PlayerEngine.ts'; const engine = (await import(path)).playerEngine;
    (window as any).__queueEngine = engine; await engine.playTrack(tracks[0], tracks);
  }, tracks);
  await expect.poll(() => page.evaluate(() => {
    const engine = (window as any).__queueEngine;
    return engine.getState().isPlaying && engine.preparingNext === null;
  })).toBe(true);
  expect(await page.evaluate(() => (window as any).__queueEngine.getState().error)).toBeNull();
  await page.evaluate(() => (window as any).__queueEngine.next());
  await expect.poll(() => page.evaluate(() => {
    const state = (window as any).__queueEngine.getState();
    return state.currentTrack?.id === 'ytm:lmnopqrstuv' && state.isPlaying && state.currentTime > 0;
  })).toBe(true);
});


test('manual skip while buffering waits for the ready song rather than opening a silent stream', async ({ page }) => {
  let streams = 0;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/**', route => route.fulfill({ json: { tracks: [], albums: [], artists: [] } }));
  await page.route('**/api/ytmusic/stream/**', route => { streams++; return route.fulfill({ body: wav(4), contentType: 'audio/wav' }); });
  await page.route('**/api/ytmusic/download/**', async route => {
    await ready; await route.fulfill({ body: wav(4), contentType: 'audio/wav' }).catch(() => {});
  });
  await page.goto('/');
  await page.evaluate(async tracks => {
    const path = '/src/lib/audio/PlayerEngine.ts'; const engine = (await import(path)).playerEngine;
    (window as any).__queueEngine = engine; await engine.playTrack(tracks[0], tracks);
  }, tracks);
  await expect.poll(() => page.evaluate(() => !!(window as any).__queueEngine.preparingNext)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    (window as any).__queueEngine.next();
  });
  expect(streams).toBe(1);
  expect(await page.evaluate(() => {
    const state = (window as any).__queueEngine.getState();
    return { loading: state.isLoading, playing: state.isPlaying, time: state.currentTime };
  })).toEqual({ loading: true, playing: false, time: 0 });
  expect(await page.evaluate(async () => {
    await (window as any).__queueEngine.play();
    return (document.querySelector('audio[data-sonora-player]') as HTMLAudioElement).paused;
  })).toBe(false);
  release();
  await expect.poll(() => page.evaluate(() => {
    const state = (window as any).__queueEngine.getState();
    return state.currentTrack?.id === 'ytm:lmnopqrstuv' && state.isPlaying && state.currentTime > 0;
  })).toBe(true);
  expect(streams).toBe(1);
  expect(await page.locator('audio[data-sonora-player]').getAttribute('src')).toMatch(/^blob:/);
});


test('returning to the app recovers a background skip whose preparation is stalled', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: { tracks: [], albums: [], artists: [] } }));
  await page.route('**/api/ytmusic/stream/**', route => route.fulfill({ body: wav(4), contentType: 'audio/wav' }));
  await page.route('**/api/ytmusic/download/**', () => {});
  await page.goto('/');
  await page.evaluate(async tracks => {
    const path = '/src/lib/audio/PlayerEngine.ts'; const engine = (await import(path)).playerEngine;
    (window as any).__queueEngine = engine; await engine.playTrack(tracks[0], tracks);
  }, tracks);
  await expect.poll(() => page.evaluate(() => !!(window as any).__queueEngine.preparingNext)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    (window as any).__queueEngine.next();
  });
  expect(await page.evaluate(() => (window as any).__queueEngine.getState().isLoading)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => {
    const state = (window as any).__queueEngine.getState();
    return state.currentTrack?.id === 'ytm:lmnopqrstuv' && state.isPlaying && !state.error;
  })).toBe(true);
});

async function pendingSkip(page: Page) {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const queue = [...tracks, { ...tracks[1], id: 'ytm:12345678901', sourceId: '12345678901', cloudKey: 'ytmusic://12345678901', title: 'Third song' }];
  await page.route('**/api/**', route => route.fulfill({ json: { tracks: [], albums: [], artists: [] } }));
  await page.route('**/api/ytmusic/stream/**', route => route.fulfill({ body: wav(4), contentType: 'audio/wav' }));
  await page.route('**/api/ytmusic/download/**', async route => {
    if (route.request().url().includes('lmnopqrstuv')) await ready;
    await route.fulfill({ body: wav(4), contentType: 'audio/wav' }).catch(() => {});
  });
  await page.goto('/');
  await page.evaluate(async queue => {
    const path = '/src/lib/audio/PlayerEngine.ts'; const engine = (await import(path)).playerEngine;
    (window as any).__queueEngine = engine; await engine.playTrack(queue[0], queue);
  }, queue);
  await expect.poll(() => page.evaluate(() => !!(window as any).__queueEngine.preparingNext)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    (window as any).__queueEngine.next();
  });
  return release;
}

test('pause during a pending skip prevents autoplay and Play resumes the selected song', async ({ page }) => {
  const release = await pendingSkip(page);
  await page.evaluate(() => (window as any).__queueEngine.pause());
  release();
  await expect.poll(() => page.evaluate(() => (window as any).__queueEngine.preparingNext === null)).toBe(true);
  expect(await page.evaluate(() => (window as any).__queueEngine.getState().isPlaying)).toBe(false);
  await page.evaluate(() => { void (window as any).__queueEngine.play(); });
  await expect.poll(() => page.evaluate(() => {
    const state = (window as any).__queueEngine.getState();
    return state.currentTrack?.id === 'ytm:lmnopqrstuv' && state.isPlaying && state.currentTime > 0;
  })).toBe(true);
  expect(await page.locator('audio[data-sonora-player]').getAttribute('src')).toMatch(/^blob:/);
});

test('a rapid second skip cancels the obsolete preparation and plays the third song', async ({ page }) => {
  const release = await pendingSkip(page);
  await page.evaluate(() => (window as any).__queueEngine.next());
  await expect.poll(() => page.evaluate(() => {
    const state = (window as any).__queueEngine.getState();
    return state.currentTrack?.id === 'ytm:12345678901' && state.isPlaying && state.currentTime > 0;
  })).toBe(true);
  release();
  await expect.poll(() => page.evaluate(() => (window as any).__queueEngine.preparingNext === null)).toBe(true);
  expect(await page.evaluate(() => (window as any).__queueEngine.getState().currentTrack.id)).toBe('ytm:12345678901');
  expect(await page.evaluate(() => (window as any).__queueEngine.getState().error)).toBeNull();
});


test('resume before buffering finishes still waits for the selected source', async ({ page }) => {
  const release = await pendingSkip(page);
  await page.evaluate(() => {
    const engine = (window as any).__queueEngine;
    engine.pause(); void engine.play();
  });
  expect(await page.evaluate(() => {
    const engine = (window as any).__queueEngine;
    return { assigned: engine.sourceAssigned, playing: engine.getState().isPlaying, loading: engine.getState().isLoading };
  })).toEqual({ assigned: false, playing: false, loading: true });
  release();
  await expect.poll(() => page.evaluate(() => {
    const state = (window as any).__queueEngine.getState();
    return state.currentTrack?.id === 'ytm:lmnopqrstuv' && state.isPlaying && state.currentTime > 0;
  })).toBe(true);
  expect(await page.locator('audio[data-sonora-player]').getAttribute('src')).toMatch(/^blob:/);
});


test('manual buffering keeps the active native audio session running', async ({ page }) => {
  const release = await pendingSkip(page);
  expect(await page.locator('audio[data-sonora-player]').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  release();
  await expect.poll(() => page.evaluate(() => (window as any).__queueEngine.getState().isPlaying)).toBe(true);
});


test('Back reuses the previous buffered song without another network request', async ({ page, context }) => {
  const release = await pendingSkip(page); release();
  await expect.poll(() => page.evaluate(() => {
    const engine = (window as any).__queueEngine;
    return engine.getState().isPlaying && engine.preparedNext?.id === 'ytm:12345678901';
  })).toBe(true);
  await page.evaluate(() => (window as any).__queueEngine.next());
  await expect.poll(() => page.evaluate(() => {
    const state = (window as any).__queueEngine.getState();
    return state.currentTrack?.id === 'ytm:12345678901' && state.isPlaying;
  })).toBe(true);
  await context.setOffline(true);
  await page.evaluate(() => (window as any).__queueEngine.previous(true));
  await expect.poll(() => page.evaluate(() => {
    const state = (window as any).__queueEngine.getState();
    return state.currentTrack?.id === 'ytm:lmnopqrstuv' && state.isPlaying && state.currentTime > 0;
  })).toBe(true);
  expect(await page.locator('audio[data-sonora-player]').getAttribute('src')).toMatch(/^blob:/);
});
