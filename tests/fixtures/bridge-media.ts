import { chromium } from 'playwright';

/** Deterministic finite PCM tone; no remote catalog dependency. */
export function wave(seconds = 1.6): Buffer {
  const rate = 24000, samples = Math.floor(rate * seconds);
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let n = 0; n < samples; n++) data.writeInt16LE(Math.round(Math.sin(n * 2 * Math.PI * 440 / rate) * 8000), 44 + n * 2);
  return data;
}

/** Only replaces YTM network responses; Chromium, uBOL, decoder and capture remain real. */
export function installMediaFixture(seconds = 1.6) {
  const original = chromium.launchPersistentContext.bind(chromium);
  const counts = { launches: 0, navigations: 0 };
  chromium.launchPersistentContext = async (profile, options) => {
    counts.launches++;
    const context = await original(profile, options);
    await context.route('https://music.youtube.com/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/fixture.wav') return route.fulfill({ contentType: 'audio/wav', body: wave(seconds) });
      counts.navigations++;
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><video style="display:none"></video><div id="movie_player"></div><script>
        const video = document.querySelector('video'), player = document.querySelector('#movie_player');
        let id = new URL(location.href).searchParams.get('v') || '';
        player.getVideoData = () => ({video_id:id});
        player.loadVideoById = next => { id = next; video.src = '/fixture.wav?v=' + encodeURIComponent(next); video.play(); };
        if (id) player.loadVideoById(id);
      </script>` });
    });
    return context;
  };
  return { counts, restore: () => { chromium.launchPersistentContext = original; } };
}
