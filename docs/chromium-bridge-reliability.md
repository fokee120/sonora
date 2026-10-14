# Chromium bridge reliability and startup

## Frontend contract

- Optional `POST /api/ytmusic/bridge/prepare?session=<same-session>` warms the isolated browser, uBOL Complete configuration, and application document. Returns `{ok:true,elapsedMs}`. It does **not** select/autoplay a track. Concurrent preparation/play session creation is single-flight. Preparation is optional, not a prerequisite for playback.
- `GET /api/ytmusic/stream/<videoId>?session=<id>&start=<nonnegative-seconds>` starts a **new** WebM container (or MP3 for iOS / `format=mp3`). `start` defaults to zero. `X-Audio-Start` echoes the requested source offset. Native audio's response-relative `currentTime` must be added to that offset for the song timeline.
- Seek/recovery replaces the audio URL with a fresh request at the desired source offset; use a cache-busting query value if the URL would otherwise remain identical. Do not set native `currentTime` to the absolute song position on this live response.
- Existing `POST /bridge/pause` and `/bridge/resume` pause/resume both source media and its recorder, preserving the same container. Existing `POST /bridge/seek` returns an explicit error for an active session explaining that a fresh stream is required; it no longer silently changes the source beneath an already-buffered frontend timeline.
- Public `play(sessionId, videoId, signal?, format?, initialPosition = 0)` preserves the existing first four arguments.
- Pre-first-byte failures return HTTP 502 JSON, not a misleading successful/empty audio response. Invalid query values return 400. After headers/body have started, capture/source failures terminate the HTTP transfer with an error; clients should use bounded retry/recovery, **not** interpret all transport errors as a normal track end.
- Natural source `ended` stops the recorder, delivers its final chunk, then ends the response normally. Client queue advancement should use this normal EOF/native ended path. A superseding play or explicit cancellation ends the old generation without touching the replacement.

## Offline download completeness

The active HTTP download route now uses the [direct downloader](DIRECT_DOWNLOADS.md), not browser recording. It fetches only the requested ID, finalizes and decodes the full file, and exposes real transfer progress. Live UI acceptance downloaded a 4:09 catalog track in 4950ms and verified 248.413375 seconds of decoded audio; offline playback passed. Five additional sequential catalog results downloaded in 3896–4351ms each without bot checks on this connection. This small sample does not establish bot-check immunity or universal availability. No capture or alternate-upload fallback is used.

### Legacy capture method (rollback coverage, not the active route)

Downloads use a unique server-generated session per request, never the playback/control session. The full capture must reach the observed source duration normally; superseded captures raise errors rather than successful EOF. Files are spooled under `.sonora/downloads`, finalized with ffmpeg, decoded in full and checked for duration before HTTP 200 is sent. Success includes `X-Audio-Complete: true`, `X-Audio-Duration` (decoded seconds), and `Content-Length`. Scratch artifacts and download contexts are cleaned after success/error/cancel. ffmpeg is required; real-time recording still takes approximately the song length, with a 256-MiB cap and the existing 10-minute deadline.

OfflineManager checks the actual blob duration before storing or marking complete, and validates legacy cache on playback. A five-second prefix of a longer song becomes failed/retryable; unaffected downloads and original catalog durations are preserved. A damaged old download must be retried/replaced, not magically repaired.

Live acceptance: started downloading a 26-second catalog track, then played another track after 5.5 seconds. The resulting 386205-byte saved WebM decoded to **25.86 seconds**, with no ffmpeg errors. Browser network was then disabled; the saved file played locally beyond **8 seconds**, retained catalog duration **26**, and reported no error. Focused verification after these changes: **20 backend tests**, **27 browser tests**, typecheck and production build passed.

## Implementation constraints

- Server startup calls `chromiumBridge.warmup()` non-blockingly to prepare one clean anonymous home/player profile. A user atomically adopts it exactly once; replenishment always creates a fresh isolated profile, never recycles a user's cookies. The spare counts toward capacity. Without a spare, cold creation loads the home shell and waits for its player API rather than the slower direct-watch bootstrap. Prepared/warm sessions prefer `loadVideoById` with identity verification and a bounded document-navigation fallback. YouTube can change this private API.
- uBOL Complete and isolation checks are unchanged: each session gets a distinct temporary persistent profile, protection is configured before any YTM navigation, and failures remain fail-closed. Set `SONORA_ADBLOCK=false` only for explicit opt-out.
- Browser output is muted at Chromium's audio output (`--mute-audio`), **not** by muting/zeroing the media element. The synthetic benchmark decodes and measures a non-silent recorded tone with this flag enabled.
- Recorder chunks are 200ms, not 1s. Readiness is actual bytes acknowledged at Node, not an `isRecording` flag or fixed 2s sleep. Playwright timeout options use the third `waitForFunction` parameter.
- Every stream has its own generation, readers, byte queue, completion/error state, and abort listener. Old callbacks and finalizers cannot reset/stop a replacement recorder. Setup mutations are serialized; cancellation during awaited capture gets a second generation-checked cleanup after the await.
- Source replacement/recorder failure/stall terminates the current container. A restarted recorder's WebM header is **never** spliced into an existing response. Reconnect using `start` instead.
- Per-stream Node buffering is capped at 1MiB. Slow consumers fail explicitly rather than growing without limit or dropping arbitrary container bytes. HTTP and ffmpeg pipelines respect backpressure. MP3 errors propagate, stderr is drained/bounded, and a missing ffmpeg is an explicit failure (never WebM mislabeled as MP3).
- Session acquisition has a 35s deadline; after acquisition capture startup has a 30s ceiling (up to 65s combined on worst-case cold failure). Playing but byte-stalled streams fail after about 10s (1s watchdog cadence). Individual page waits/navigation are bounded. The route retains its existing 10-minute transfer ceiling. Cancellation returns promptly even during shared browser launch; the single-flight launch may finish warming in the background.
- Ten sessions maximum; capacity failure is explicit rather than evicting another user's playing session. Idle sessions expire after 15 minutes. Playback uses real-time capture; the active download route uses the independent direct-file provider. Network/YouTube/extension initialization latency is not eliminated and is not advertised as seamless.

## Repeatable verification (no port-3000 restart needed)

```sh
node --import tsx --test tests/bridge-stream.test.ts tests/bridge-lifecycle.test.ts tests/bridge-pool.test.ts tests/bridge-transcode.test.ts tests/bridge-api.test.ts tests/chromium-capture.test.ts tests/chromium-adblock.test.ts
npx playwright test tests/playback-shell.spec.ts tests/player-reliability.spec.ts tests/youtube-audio.spec.ts
npm run lint
npm run build
node --import tsx scripts/benchmark-bridge.ts --iterations=3
```

The default benchmark replaces only YTM network responses with a finite generated PCM tone and player API fixture. It retains real Chromium, real installed uBOL Complete, actual media decoding/capture/MediaRecorder, Node queueing, and ffmpeg decoding. It validates non-silent output, first-byte timings, end-of-stream, direct cold navigation, single-flight preparation, warm transitions, source-offset seek, and MP3. IDs are generated dynamically; there are no production/test catalog IDs added.

Optional real-network benchmark (select current playable tracks yourself):

```sh
node --import tsx scripts/benchmark-bridge.ts --live --track=<video-id> --next-track=<different-video-id> --iterations=3
```

`SONORA_BENCH_TRACK` can supply the first ID instead. `--next-track` is optional, but provide it to exercise real warm track switching, rather than repeating one track. Live mode samples about 2.5s after the first byte and validates decoding; it does **not** claim to verify full live-song EOF, advertisements, or every region's availability. The parent/browser acceptance should exercise those. Both modes use their own isolated browsers and never restart the app server.

Set `SONORA_DEBUG_PERF=true` for structured `[bridge]` timing logs: browser-and-adblock, application-loaded, prepared, capture-first-byte. `ChromiumBridge` also emits `timing` events. API first-byte timing now starts at request entry and is logged only after actual first bytes.

## Real browser acceptance on this PC

Actual Sonora UI clicks against the local Express server and live YT Music (not mocked media): first song reached native `playing` in **2897ms**, second catalog song in **4317ms**. Both continued to about **10.8 seconds of decoded playback** during 11-second observation windows. Pause froze the native timeline; resume worked; keyboard seek opened a fresh offset stream and played; rapid switching finished on the last requested song. Browser JavaScript errors: none. The earlier direct-watch implementation measured **21209ms** for the first song in the same UI harness. These are individual observations, not percentile guarantees or proof for every song/network condition. A brief initial rebuffer was observed in the event trace; this is improved playback, not zero-gap playback.

Search now starts optional prepare on entering YouTube mode. The dev server no longer registers a PWA worker, retires older same-scope workers without deleting music IndexedDB, and excludes generated/test/profile files from HMR reloads. Production PWA/offline behavior remains enabled.

Final focused verification: **16 backend tests** and **20 browser playback/shell tests** passed; typecheck and build passed. The broader existing Drive test run still had three missing persistent-storage-button failures; a Drive playback timing failure passed when rerun alone. Full live-song EOF is covered by finite local-media tests, not a full-length live-track observation.

## Local synthetic baseline before the final startup-pool change

One run with official uBOL enabled (2026.1012.1545):

| Case | First bytes at Node |
| --- | ---: |
| Cold direct browser + uBOL + watch | 2047.8ms |
| Single-flight prepare (separate session) | 1990.0ms |
| Warm first track | 412.9ms |
| Warm change 2 | 295.4ms |
| Warm change 3 | 294.3ms |
| Fresh response from 0.7s | 781.2ms |
| MP3 | 343.2ms |

Two profiles, two YTM document navigations for the entire run. WebM outputs decoded to 12,960 mono samples at 8kHz with RMS approximately 0.17; the seek output decoded to 8,640 samples; MP3 decoded to 13,375 samples with RMS 0.16. These are **local synthetic-media timings**, not a promise about live YouTube/network playback. The prior standalone capture test measured 2381.2ms before the fix; the byte-driven standalone test subsequently measured 568.1ms (separate process/run; not a controlled production A/B).
