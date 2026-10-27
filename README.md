# Sonora

A personal music player for YouTube Music discovery, playlists and offline listening.
Google Drive, Firebase sign-in and the old cloud-vault integration have been removed.
Existing local downloads, playlists and listening history are retained.

## Navigation

Home, Search and Library are the three main pages. Swipe left/right across the
page background to move between them. Settings opens from the gear on Home.
Library opens to Playlists and also has a Songs tab. Downloads are in
Settings → Downloads, alongside offline readiness and storage controls.

## Player and song gestures

- Swipe left on the mini player or expanded player for the next song; right for
  the previous song. Artwork and song titles slide during track changes.
- Tap the mini player to expand it. Swipe down on the expanded player to close it,
  including from its artwork, title or background. Sliders keep their own gestures.
- Swipe a song row left-to-right to add it to the queue; right-to-left to open the
  playlist picker. Swipe actions do not also start playback or change the page.
- Recently Played shows each song once, ordered by its latest play. The full
  listening history is retained separately for recommendations.

Lock-screen/Control Center actions use previous/next track rather than short
rewind/forward actions. Short-seek actions are disabled on iOS too. Registration
happens after playback activation and is repeated after native audio startup.
Temporary first-party diagnostics record registration results and received command
names (no music metadata or identifiers). Timeline dragging remains available.
iOS reuses its user-started audio element for queue changes, keeps the media session
active between songs, and omits tap sounds that create a competing audio session.
For iOS streamed queues, one upcoming song is buffered and validated in memory
(up to 32 MiB) while the current song plays. The handoff uses that ready source
without waiting for a new live bridge stream. It does not save an offline download.
Manual skips join a pending preparation and show loading until the source is ready.
The existing audio stays active during this wait so iOS does not suspend its output;
the current song may continue briefly. Native metadata changes with the new source.
Repeated lock-screen track commands are ignored during the handoff, and one previous
buffered stream is retained for Back without another request.
A rapid second skip cancels the obsolete preparation. A background preparation
failure produces a retry message instead of opening a silent live stream. Foreground
failures retain normal streaming as a fallback.
Native offline EOF advancement and prepared-stream EOF with network disabled are covered by `tests/ios-queue.spec.ts`; a physical
iPhone remains necessary to verify OS lock-screen presentation and suspension. Media Session
metadata uses the high-resolution cover (including saved artwork offline), its
actual pixel dimensions and image type. Delayed artwork from an older song cannot
overwrite the current song. Run `npx playwright test --config playwright.media.config.ts`
for these checks; engines without Media Session support skip the native API tests.

Artwork uses higher resolution source URLs where available, with a fallback when
an upgraded URL is unavailable. Downloaded covers are saved as image bytes in
IndexedDB for offline rendering. Settings → General → Upgrade downloaded covers
repairs older downloads while online. Available quality depends on the source.

## Run locally

```sh
npm install
npm run build
npm start
```

The production server listens on port 3000 (`PORT` can override it). `npm run dev`
is an editor preview and deliberately disables offline service-worker installation.
The Chromium audio bridge needs a persistent Node host and its Playwright browser.

## iPhone and offline opening

Use a production build over HTTPS. An HTTP LAN/Tailscale IP cannot install the
service worker on an iPhone. A private Tailscale HTTPS listener can be configured:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:3000
```

Open the HTTPS address in Safari and add it to the Home Screen. Open the installed
app online, visit Settings → Downloads, and wait for **Ready to open offline**.
Download songs inside that installed app. Different addresses and browser/Home
Screen storage can have separate libraries. iOS can still clear website data.

The standalone layout sizes the document, root and app with `100lvh` (`100vh`
fallback). On iOS, `100dvh` can exclude the status-bar region even in standalone
mode, leaving a bottom strip. Browser tabs and an open keyboard still use the
visible viewport. Layout tests model both the shorter visual viewport and the
separate shortened-dvh behavior; a physical iPhone remains the final check.

## Playlist import

Public Spotify previews and public YouTube Music playlists can be imported from
Library or Settings. Entries are matched by title and artist to playable music;
unmatched songs are reported. Spotify embeds may contain only part of a playlist,
so the available count and a warning appear before matching. No Spotify login,
secret or Premium is required for public previews. Private/full-account imports
need Spotify's optional API connection and a Premium app owner. Configure
`SPOTIFY_CLIENT_ID` and `SPOTIFY_REDIRECT_URI` for that optional PKCE flow.

## Verification

```sh
npm run lint
npm run test:ui
npm run test:pwa
npx playwright test tests/player-reliability.spec.ts tests/offline-completeness.spec.ts
```

UI tests cover Chromium and WebKit: standalone sizing, navigation, row/player
swipes, playlist selection, settings overflow, repeat history and offline artwork.
Audio tests use native audio fixtures in Chromium to verify complete downloads
and uninterrupted playback during navigation. Production PWA tests restart the
browser with the origin stopped. Windows WebKit has media/offline-emulation
limitations, so it is not a substitute for final testing on an actual iPhone.


## Automatic cache and playlists

Settings → General → Automatic song cache starts with a 2 GB budget. Library,
Home/playlist suggestions and played tracks enter a background queue. Cache files
use their own IndexedDB store; clearing/evicting them never removes explicit
Downloads. Unplayed entries are evicted before older played entries. A valid cached
song plays offline without being labelled an explicit download. The cache validates
complete audio, deduplicates shared requests, keeps writes within the budget and
reports unavailable files for retry. Individual automatic transfers are bounded at
32 MiB. Browser storage quotas and source availability still apply.

Playlist recommendations appear below the track list. The + adds an entry to the
playlist; repeat-off playback continues into those recommendations at the end.
Edit playlist changes the title, description and a locally uploaded square cover.
Pin keeps playlists above the unpinned Recent/Alphabetical ordering.

YouTube import follows continuation pages rather than only the initial 100 songs.
Original video IDs are retained; entries without IDs and Spotify entries are
matched against the catalog. Import progress is persisted in batches and resumes
on reopening. Source additions sync every 15 minutes while the app is open and
online; local additions, custom covers and names survive sync. iOS can suspend
background work when the installed app is closed. Sync does not remove locally
kept songs when the source removes them.
