// Temporary first-party diagnostics for the installed iOS playback-control issue.
// No song names, library contents, user identifiers or playback URLs are sent.
const build = 'track-controls-5';
let sent = 0;
let lastRegistration = '';
export function reportMediaControls(event: string, details: Record<string, string> = {}) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios || sent >= 24) return;
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
