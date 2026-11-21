// Temporary first-party diagnostics for the installed iOS playback-control issue.
// No song names, library contents, user identifiers or playback URLs are sent.
// Server diagnostic schema version, independent of the app build.
const build = 'track-controls-4';
let sent = 0;
let lastRegistration = '';
export function reportMediaControls(event: string, details: Record<string, string> = {}) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios || sent >= 512) return;
  if (event === 'registered') {
    const signature = JSON.stringify(details);
    if (signature === lastRegistration) return;
    lastRegistration = signature;
  }
  sent++;
  const payload = { build, event, details, standalone: matchMedia('(display-mode: standalone)').matches || !!(navigator as any).standalone };
  void fetch('/api/player-controls-diagnostic', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), keepalive: true,
  }).catch(() => {});
}

/** Passive evidence only: neither a playing event nor a moving clock proves audible output. */
export function observeRemoteResume(audio: HTMLAudioElement, isCurrent: () => boolean, source: string): () => void {
  const start = audio.currentTime;
  let finished = false;
  const cancel = () => {
    finished = true;
    clearTimeout(timer);
    audio.removeEventListener('timeupdate', progress);
  };
  const sample = () => {
    if (finished) return;
    cancel();
    if (!isCurrent()) return;
    let session = 'sessionUnknown';
    try {
      const state = (navigator as any).audioSession?.state;
      if (state === 'active') session = 'sessionActive';
      else if (state === 'inactive') session = 'sessionInactive';
      else if (state === 'interrupted') session = 'sessionInterrupted';
    } catch { /* Optional native state is diagnostic, never a playback prerequisite. */ }
    reportMediaControls('command', {
      action: 'resumeClock', source, visibility: document.visibilityState,
      play: audio.currentTime > start + 0.1 ? 'clockAdvancing' : 'clockStopped',
      pause: audio.paused ? 'nativePaused' : 'nativePlaying', queued: session,
    });
  };
  const progress = () => { if (audio.currentTime > start + 0.1) sample(); };
  // Background suspension can delay this sample; visibility is captured at
  // sampling time so foreground-delayed evidence is not labelled hidden.
  const timer = setTimeout(sample, 1000);
  audio.addEventListener('timeupdate', progress);
  return cancel;
}
