# Sonora

Your private cloud music player, tuned for personal libraries that deserve better than a dusty folder full of MP3s.

Sonora is a full-stack React music app for YouTube Music playback, streaming your own audio collection from Google Drive, saving tracks offline, and building playlists. It opens without an account gate; Google sign-in is optional and used only for Drive. The Chromium audio bridge runs on a persistent Node host.

![Sonora preview](public/icon.svg)

## What It Does

- Streams personal MP3, M4A, and FLAC files from Google Drive
- Scans your whole Drive for supported audio files
- Reads real track duration and metadata where the browser can access it
- Saves Drive tracks into browser storage for offline playback
- Supports playlists, liked songs, albums, artists, search, downloads, and queue controls
- Opens immediately without a local email account; Google sign-in is only for Drive
- Runs as a PWA so it can feel closer to a native music app
- Keeps existing personal downloads and playlists when disconnected

## Why Sonora Exists

Music files are still wonderful. They are yours, they do not disappear from a catalog overnight, and they can live anywhere you want them to. Sonora gives that library a proper home: quick search, clean browsing, optional Drive sign-in, offline access, and a player that feels made for actual daily use.

It is not trying to be a giant streaming platform. It is a personal vault with nice speakers.

## Core Features

### Google Drive Library

Connect your Google account, press **Rescan**, and Sonora indexes supported audio files across your Drive. Tracks are streamed directly from Google Drive using your signed-in browser session.

Supported extensions include:

- `.mp3`
- `.m4a`
- `.flac`
- `.wav`
- `.aac`
- `.ogg`

### Offline Downloads

Press the download button on a supported track and Sonora stores the audio in IndexedDB, inside the browser's storage quota. Once saved, downloaded tracks can play without fetching the file again.

Browser storage protection is requested from the Settings page when available. Some browsers may decline persistent storage automatically, but downloads can still work inside normal browser quota.

### PWA Ready

The app includes a Vite PWA setup, offline-aware UI, and install support. On supported browsers, Sonora can be installed to the home screen or desktop.

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Express
- Vercel Serverless Functions
- Firebase Auth for Google Drive sign-in
- Google Drive API
- IndexedDB via `idb`
- `music-metadata` for audio metadata
- Playwright for browser tests

## Getting Started

Install dependencies:

```bash
npm install
```

Create an environment file:

```bash
cp .env.example .env
```

Run the app locally:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Run type checks:

```bash
npm run lint
```

Run browser tests:

```bash
npm run test
```

## Environment Variables

Copy `.env.example` to `.env` and fill in the values you need.

```env
GEMINI_API_KEY="MY_GEMINI_API_KEY"
APP_URL="https://your-site.vercel.app"

```

### Required For Google Drive

Google Drive sign-in uses Firebase client configuration in the app and Google OAuth scopes for Drive file access. In Firebase and Google Cloud, make sure:

- your Vercel domain is added to Firebase Auth authorized domains
- Google sign-in is enabled
- your OAuth consent screen allows the account you are using while the app is in testing
- the Drive API is enabled for the Google Cloud project behind your Firebase app

## Deploying To Vercel

1. Import the GitHub repository into Vercel.
2. Add the environment variables from `.env.example`.
3. Set `APP_URL` to your Vercel production URL.
4. Add the same Vercel domain to Firebase Auth authorized domains.
5. Deploy.

After deployment, open Settings, connect Google Drive, then press **Rescan**.

## How Drive Files Are Named

Sonora can use filenames when embedded metadata is unavailable. A name like this:

```text
Song Title - Artist Name.mp3
```

is shown as:

- Title: `Song Title`
- Artist: `Artist Name`

If the file has readable ID3 metadata, Sonora can use richer track details over time.

## Library ownership

A fresh library is empty. Add music through Google Drive or YouTube Music; there are no bundled songs or remote sample fallbacks. Upgrades remove only the seven exact IDs from the retired bundled catalog. Personal tracks, playlists, download state and audio bytes are preserved. Older unsupported cloud tracks remain local records and can play downloaded audio; otherwise import them from Drive or search YouTube Music again.

## Offline Notes

Offline playback depends on the browser storing the audio file successfully. Storage quota and persistence behavior are controlled by the browser, not the app.

Best results:

- use Chrome, Edge, or another modern Chromium browser
- install Sonora as a PWA
- request storage protection in Settings
- keep very large libraries in Drive and download only the tracks you want offline

## Project Structure

```text
api/                  Vercel serverless endpoints
src/components/       App UI components
src/context/          Shared app state and library actions
src/hooks/            Player, network, and PWA hooks
src/lib/audio/        Playback, Drive media fetching, metadata helpers
src/lib/offline/      IndexedDB audio storage and download manager
src/server/           Local Express server, Drive and YouTube Music integrations
src/views/            Main app screens
tests/                Playwright browser tests
```

## Current Checkpoint

Known-good deployed checkpoint:

```text
a044677a4af91e636556320ac1f46ba41ecc6a8a
```

If a future experiment goes sideways, this is the commit to return to.

## Sonora accounts, recommendations, and playlist import

- **Sign in with Google is now the Sonora account**, not just Drive access.
  Firebase Auth persistence keeps you signed in when the server goes down
  or restarts (the SDK refreshes its own tokens). Sonora's account record
  holds profile + preferences only — never a Google token — saved in
  IndexedDB on the device and mirrored to the persistent host's
  `.sonora-accounts.json` (`POST /api/accounts/sync`, `GET /api/accounts/:uid`).
  Set favourite genres/artists/vibes in Settings → Sonora Account.
- **Recommended for you** (Home) scores your own library against a taste
  profile built from plays, likes, playlist membership, and explicit
  preferences (`src/lib/taste.ts`, `src/lib/recommendations.ts`). No taste
  signals means no recommendations — nothing is invented.
- **Suggested songs** (Home) searches YouTube Music's catalog by your top
  artists/genres. Honest limit: this is taste-derived, **not** your
  signed-in YouTube Music home feed. Sonora's bridge uses anonymous
  Chromium profiles, so there is no YTM account session to read yet;
  adding a YTM login to the bridge is the prerequisite for true
  YTM-profile suggestions, and it is deliberately not in this change
  (it would mean storing a Google session in the bridge).
- **Import playlist by URL** (Settings → Import a playlist): Spotify,
  YouTube Music, and YouTube playlist links. Each entry is matched to a
  playable YouTube Music track by title/artist similarity; matched tracks
  become a new Sonora playlist, unmatched entries are listed and never
  silently swapped for a wrong song. Spotify needs `SPOTIFY_CLIENT_ID` /
  `SPOTIFY_CLIENT_SECRET` on the host (see `.env.example`); without them
  the import endpoint answers 501 with a setup message.
- Tests: `tests/accounts-recommendations-import.test.ts`
  (`npx tsx --test tests/accounts-recommendations-import.test.ts`).

## Roadmap Ideas

- Local drag-and-drop audio importer
- Better album artwork extraction
- Playlist import/export
- More detailed download progress
- Cross-device library sync through a real database
- Optional direct-link audio imports for files you control

## License

Private personal project. Add a license before publishing or accepting outside contributions.

## YouTube Music audio playback

Search uses the YouTube Music catalog. Playback streams WebM/Opus from an isolated, prewarmed Chromium player through `/api/ytmusic/stream/:videoId`; iOS receives MP3 via ffmpeg. Track changes reuse the loaded player. Seeking opens a fresh capture at the requested song position.

Downloads fetch the exact source audio with yt-dlp instead of recording it. Install or update the local downloader with `node scripts/setup-downloader.mjs` (requires uv); ffmpeg and Node must also be available. The UI reports actual transfer bytes, followed by finalization and native audio verification. Only a finalized, fully decoded and duration-checked file is saved to IndexedDB and marked 100%. In a live local UI test, a 4:09 catalog song was downloaded and saved in 4.95 seconds, with 248.41 seconds of decoded audio verified. This is a measured sample, not a guarantee for every track/IP. Bot checks and unavailable sources fail explicitly; no alternate song or real-time recording fallback is used. See [direct-download setup and tests](docs/DIRECT_DOWNLOADS.md).

The bridge needs Playwright Chromium, ffmpeg, and the official unpacked uBlock Origin Lite extension under `.sonora/extensions/ublock-origin-lite` (or `SONORA_ADBLOCK_EXTENSION_DIR`). No separate audio-service URL or account is needed for the local bridge. A standard serverless function is not a suitable host for persistent Chromium sessions; Vercel-only deployment does not supply this local audio runtime.

See [bridge reliability and verification](docs/chromium-bridge-reliability.md) for the implementation contract and repeatable tests. The optional `services/audio` experiment and its live-provider test are not the active Chromium playback path.
