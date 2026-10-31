# Self-hosting Sonora

## Runtime

Use Node.js 22+, FFmpeg on PATH, Playwright Chromium, and Python with `yt-dlp[default]` installed in `.sonora/tools/yt-dlp-env` (see the README). On Linux, install Chromium's OS dependencies with `npx playwright install --with-deps chromium`. The audio host must stay running; a static web host alone cannot provide streaming or downloads.

Run `npm ci`, `npm run build`, then `npm start`. The production server defaults to port 3000. Set `PORT` to change it. Run from the repository root so storage and runtime paths resolve correctly.

Copy `.env.example` to `.env` and fill only the settings you use. Never commit `.env`, browser sessions, logs or `.sonora/`.

## Google sign-in and device sync

1. Create a Google OAuth **Web application** client for your installation.
2. Add your exact HTTPS origin to its authorized JavaScript origins. For local production testing, also allow `http://localhost:3000`.
3. Set `GOOGLE_CLIENT_ID` to its public client ID and `SONORA_PUBLIC_ORIGIN` to your exact public origin, including the port when used.
4. Restart the server and sign in through Settings. The app verifies Google identity on the server before creating its account session.

Library metadata, playlists, favorites and listening records sync through this Sonora host. Profiles support independently public/private playlists, recap and history. Downloads and the automatic audio cache remain local to each device.

Account data defaults to `.sonora/google-library.json`; `SONORA_ACCOUNT_FILE` can select a persistent file outside the checkout. Back up that file securely: it contains user data and sessions. Use a single server process for this file-backed store. Running independent replicas against the same file is not supported.

## HTTPS and iPhone installation

Put the persistent server behind an HTTPS reverse proxy. Preserve the origin and forwarded protocol headers. Configure the same external origin in Google OAuth and `SONORA_PUBLIC_ORIGIN`.

A private Tailscale listener is another option:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:3000
```

That command provides private Tailscale access. Public access needs an explicitly configured public proxy or tunnel. An ordinary HTTP LAN address does not provide the secure context iPhone service workers need.

In Safari, use Share → Add to Home Screen. Open the installed app online once and check Settings → Downloads for offline readiness. Explicitly download songs in that installed app. iOS may suspend long tasks when the app is backgrounded or closed; keep it open for large imports/downloads.

## Public playlist imports

Public Spotify URL imports use public metadata and match song title + artist to the playable catalog. They follow available pages and report partial/unavailable sources instead of quietly treating a preview as a complete import. Private playlists are not supported by this anonymous route. Upstream changes or limits may affect imports.

The optional Spotify PKCE connection uses `SPOTIFY_CLIENT_ID` and `SPOTIFY_REDIRECT_URI`; no client secret is required. Google sign-in is independent of Spotify. Keep the redirect URI exact.

## Windows tray controller

After building, double-click `Sonora Server.vbs` or run `scripts/server-control.ps1`. The controller runs the server with a tray menu and writes logs to `.sonora/logs/server-control.log`. Paths are resolved relative to the checkout. Machine-specific `.lnk` shortcuts are intentionally excluded from Git.

## Updating

Back up your account file, fetch the desired release or branch, run `npm ci` and `npm run build`, then restart the persistent server. Do not delete `.sonora/` or clear browser storage during an update. Keep previous hashed assets available during a rollout if clients may still have an older app open.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| App opens but audio fails | Chromium is installed, FFmpeg is on PATH, the host can reach YouTube, and the persistent process is running. |
| Direct downloads are unavailable | The downloader virtual environment exists, or `SONORA_YTDLP_PYTHON` points to its Python executable. Update `yt-dlp[default]` when upstream extraction changes. |
| Some uploads fail | Removed, private, region-limited or otherwise restricted media may be unavailable. Transient source URLs are retried automatically within bounds. |
| Google button is missing | `GOOGLE_CLIENT_ID` is configured, the server restarted, and the client permits this exact origin. |
| Offline opening fails on iPhone | Use the production HTTPS install, open it online first, and check offline readiness. Verify iOS has not evicted the app's storage. |
| A cancelled request prints an error | Current versions silence routine disconnects and superseded streams. Genuine provider, decoding and timeout failures remain logged. |

Set `SONORA_DEBUG_PERF=true` only when investigating timing. Review logs before sharing them; they can contain source identifiers or operational details.

## Browser bridge protection

By default the hidden Chromium bridge requires an unpacked **uBlock Origin Lite** Manifest V3 extension, including its background service worker. Obtain the unpacked extension from its official distribution and place its files (with `manifest.json` at the top level) in `.sonora/extensions/ublock-origin-lite`. Alternatively set `SONORA_ADBLOCK_EXTENSION_DIR` to its absolute directory. The extension is a host dependency and is not committed to this repository.

If it is missing or invalid, streaming initialization fails with an explicit setup error. Administrators who intentionally want to run without that protection can set `SONORA_ADBLOCK=false`; it is an explicit opt-out, not the default. Restart after changing bridge settings.
