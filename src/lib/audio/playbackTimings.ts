const detailed = import.meta.env.VITE_SHOW_AUDIO_BACKEND === 'true';
let trace = '';
let started = 0;
let hasPlayed = false;

export function beginPlaybackTiming() {
  trace = Math.random().toString(36).slice(2) + Date.now().toString(36);
  started = performance.now();
  hasPlayed = false;
  playbackTiming('load_start');
}

export function playbackTrace() { return trace; }

export function playbackTiming(event: string, audio?: HTMLAudioElement) {
  const elapsedMs = Math.round(performance.now() - started);
  const initialPlay = event === 'playing' && !hasPlayed;
  if (initialPlay) hasPlayed = true;
  const startupReport = event === 'startup_timeout' || (initialPlay && elapsedMs >= 2_500);
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!trace || (!detailed && !(startupReport && ios))) return;
  let buffered = 0;
  try {
    if (audio?.buffered.length) buffered = Math.max(0, audio.buffered.end(audio.buffered.length - 1) - audio.currentTime);
  } catch {}
  void fetch('/api/ytmusic/bridge/playback-timing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trace, event, elapsedMs,
      readyState: audio?.readyState, networkState: audio?.networkState,
      bufferedSeconds: Math.round(buffered * 100) / 100, mediaError: audio?.error?.code,
    }),
    keepalive: true,
  }).catch(() => {});
}

