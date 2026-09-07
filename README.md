# Sonora

Your private cloud music player, tuned for personal libraries that deserve better than a dusty folder full of MP3s.

Sonora is a full-stack React music app for streaming your own audio collection from Google Drive, saving tracks for offline playback, building playlists, and keeping a polished music-library experience across devices. It is designed for people who want a Spotify-like home for files they already own, with private access control and a lightweight Vercel deployment.

![Sonora preview](public/icon.svg)

## What It Does

- Streams personal MP3, M4A, and FLAC files from Google Drive
- Scans your whole Drive for supported audio files
- Reads real track duration and metadata where the browser can access it
- Saves Drive tracks into browser storage for offline playback
- Supports playlists, liked songs, albums, artists, search, downloads, and queue controls
- Keeps app sign-in persistent with a secure server-side session
- Runs as a PWA so it can feel closer to a native music app
- Falls back cleanly when offline, disconnected, or missing cloud credentials

## Why Sonora Exists

Music files are still wonderful. They are yours, they do not disappear from a catalog overnight, and they can live anywhere you want them to. Sonora gives that library a proper home: quick search, clean browsing, persistent login, offline access, and a player that feels made for actual daily use.

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

### Private App Access

Sonora can require an approved email before the music player opens. The auth session is signed with `AUTH_SECRET` and kept persistent so you do not have to log in every time you open the site.

### PWA Ready

The app includes a Vite PWA setup, offline-aware UI, and install support. On supported browsers, Sonora can be installed to the home screen or desktop.

### Cloud Storage Mode

The project includes optional Google Cloud Storage support for serving a bundled/private cloud library. If GCS credentials are not configured, Sonora can still run in demo or Drive mode.

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

GCP_PROJECT_ID=
GCS_BUCKET_NAME=
GCP_CLIENT_EMAIL=
GCP_PRIVATE_KEY=

AUTHORIZED_EMAILS=you@example.com
AUTH_SECRET=replace-this-with-a-long-random-secret
```

### Required For Private Access

`AUTHORIZED_EMAILS` is a comma-separated list of emails allowed into the player.

`AUTH_SECRET` signs the persistent app session. Use a long random value in production. Do not leave the example value in Vercel.

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
src/server/           Local Express server and cloud storage helpers
src/views/            Main app screens
tests/                Playwright browser tests
```

## Current Checkpoint

Known-good deployed checkpoint:

```text
a044677a4af91e636556320ac1f46ba41ecc6a8a
```

If a future experiment goes sideways, this is the commit to return to.

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

Search and audio delivery are separate services. Playback uses the existing Sonora player and the same server audio resolver as offline downloads. For hosts where YouTube blocks direct audio access, configure a working Cobalt-compatible instance with `COBALT_API_URL` and, if needed, `COBALT_API_KEY`. Use `YT_DOWNLOADER_AUDIO_FORMAT=m4a` or `mp3` for broad browser compatibility. Set these in the hosting environment and redeploy; runtime Settings are temporary and instance-specific on serverless hosts. Public fallback services are best-effort and may be unavailable.
