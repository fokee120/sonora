# Sonora Chromium Bridge — Setup Guide

## What this is

Your Sonora server now includes a hidden Chromium browser that plays the real
YouTube Music web app. When you click play in Sonora, the bridge:

1. Opens `music.youtube.com/watch?v=...` in a headless Chromium (you never see it)
2. Captures audio directly from the page via `captureStream()` + MediaRecorder
3. Streams it back through the same `/api/ytmusic/stream/:videoId` endpoint

No second tab. No manual steps. YouTube's bot defenses (PO tokens, SABR, n-sig)
all work because it's the genuine web client.

## Installation

```bash
# In your sonora repo directory:
npm install

# Install Playwright's Chromium (one-time, ~150MB download):
npx playwright install chromium

# Install ffmpeg (required for iOS/PWA MP3 support):
# Windows: winget install ffmpeg
# Mac: brew install ffmpeg
# Linux: sudo apt install ffmpeg
```

## iOS PWA support

Yes — the bridge works with the iOS PWA. The PWA is just a client; all the
heavy lifting (Chromium, YouTube Music, audio capture) happens on your server.
Your iPhone just plays an HTTP audio stream.

One catch: iOS Safari cannot play WebM/Opus audio. The bridge auto-detects iOS
via User-Agent and transcodes to MP3 on the fly using ffmpeg. This requires
ffmpeg installed on the server (see above). Desktop browsers get WebM/Opus
directly (lower CPU, no transcoding).

You can also force MP3 for any client with `?format=mp3` on the stream URL.

## Running

```bash
npm run dev
```

That's it. The bridge launches lazily on the first song you play. Chromium runs
headless — no window, no tab, completely invisible.

## How it works

| What you do in Sonora | What happens behind the scenes |
|-----------------------|-------------------------------|
| Click play on a song | Bridge navigates hidden Chromium to the song, captures audio, streams it back |
| Pause | Frontend tells bridge to pause Chromium's player (stays in sync) |
| Resume | Bridge resumes Chromium, audio stream continues |
| Seek | Bridge seeks Chromium's player to the position |
| Download | Bridge captures the full song in real-time, serves it as a `.webm` file |

## Files changed

- **NEW** `src/server/bridge/ChromiumBridge.ts` — Playwright controller, audio capture
- `src/server/ytmusic/api.ts` — stream/download routes now use the bridge; added `/bridge/pause`, `/bridge/resume`, `/bridge/seek`, `/bridge/now-playing`
- `src/lib/audio/PlayerEngine.ts` — pause/play/seek notify the bridge for YouTube tracks
- `package.json` — added `playwright` dependency

## What stayed the same

- Search still uses InnerTube (`YoutubeMusicClient.ts`) — search doesn't need PO tokens, so it works fine
- All React views, library, playlists, offline storage — untouched
- Drive audio — untouched
- The API endpoint URLs (`/api/ytmusic/stream/:videoId`, `/api/ytmusic/download/:videoId`) — unchanged, so nothing else breaks

## Multi-user support

Each browser gets a unique session ID (stored in localStorage). The bridge
gives every session its own isolated Chromium context, so multiple people can
play different songs simultaneously without interfering.

- Sessions idle for 15 minutes are cleaned up automatically
- Max 10 concurrent sessions (oldest idle evicted first)
- Each session uses ~100-200MB RAM — plan server memory accordingly

## Known limitations

- **Downloads are real-time.** Capturing a 4-minute song takes 4 minutes. This is inherent to the bridge approach — you're recording what the real player plays.
- **Download format:** WebM/Opus on desktop, MP3 on iOS (auto-transcoded via ffmpeg). If you need MP3 everywhere, add `?format=mp3` to the stream URL.
- **First play is slow** (~5-10s). Chromium has to launch and load YouTube Music. Subsequent songs are fast (browser stays alive).
- **Seek restarts capture.** Seeking tells Chromium to jump, but the audio stream restarts from the new position. Minor gap, acceptable.
- **Vercel/serverless won't work.** Headless Chromium needs a real server. Run `npm run dev` locally, or deploy the server to a VPS.
- **ffmpeg required for iOS.** Without it, iOS clients get WebM which Safari can't play. The bridge falls back gracefully (serves WebM with a warning header).

## Troubleshooting

- **"Audio capture failed: no media element"** — YouTube Music didn't load. Check your internet, try again.
- **"Browser closed unexpectedly"** — Run `npx playwright install chromium` again.
- **No audio** — Make sure you're on a recent Chrome/Chromium (Playwright bundles its own, so this is automatic).
- **Slow first load** — Normal. The bridge is launching a full browser.
