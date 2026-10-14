# Direct offline downloads

Only `/api/ytmusic/download/:videoId` uses yt-dlp. Chromium playback and the legacy `chromiumBridge.download` capture method remain unchanged. Failed direct transfers never fall back to capture or another upload.

## Install

From the repository root (ffmpeg and Node must be on PATH):

```sh
uv venv .sonora/tools/yt-dlp-env
uv pip install --python .sonora/tools/yt-dlp-env/Scripts/python.exe "yt-dlp[default]"
```

On Linux/macOS use `.sonora/tools/yt-dlp-env/bin/python` instead. Alternatively set `SONORA_YTDLP_PYTHON` to an existing Python executable with `yt-dlp[default]` installed. Missing executables return HTTP 503 with `fast_download_unavailable`. Run the server from the repository root.

The provider builds the exact music.youtube.com URL from a validated 11-character video ID. It ignores external yt-dlp configuration, disables playlists, prefers Opus/WebM audio, and explicitly supplies the running Node executable as yt-dlp's JavaScript runtime. AAC/M4A fallback files are transcoded to Opus for WebM output. MP3 output uses libmp3lame.

## Progress and integrity

A valid `requestId` and non-default session enable `/api/ytmusic/download-status/:requestId`. Status is isolated by session. `fetching` reports actual yt-dlp machine progress (`downloadedBytes`, `totalBytes`; zero when unknown), with `progress` capped at 95. Compatibility `recordedSeconds` remains zero. `sourceDuration` is populated from metadata during finalization. No elapsed-time estimate is presented as transfer progress.

Each job has a 90-second deadline, bounded diagnostics, and a 256 MiB disk budget. Abort terminates the yt-dlp process tree on Windows. Audio remains on disk, not buffered in application memory. The shared ffmpeg finalizer makes seekable WebM/MP3 and independently decodes all packets; its decoded duration must match the exact-ID yt-dlp info JSON within the established tolerance. Only validated complete artifacts receive HTTP 200 and `X-Audio-Complete: true`, `X-Audio-Duration`, and `Content-Length`. Direct responses identify `X-Audio-Via: sonora-direct-download`.

## Backend checks

```sh
node --import tsx --test --test-concurrency=1 tests/direct-download.test.ts tests/download-artifact.test.ts tests/download-jobs.test.ts tests/bridge-download.test.ts tests/bridge-api.test.ts
npx tsc --noEmit
```

Direct tests run a local fixture CLI subprocess that emits machine progress and finite generated audio. They cover duration mismatch, malformed media, cancellation cleanup, unavailable executable, exact-ID input validation, AAC conversion, route headers, and session isolation. The separate Chromium capture test uses an explicit test-only capture route to retain rollback coverage; it is not a production fallback.
