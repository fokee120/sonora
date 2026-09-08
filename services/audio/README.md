# Sonora Audio Service

Small YouTube-to-MP3 backend for Sonora. It accepts only 11-character YouTube video IDs, runs `yt-dlp` itself, converts with ffmpeg, and streams `audio/mpeg` bytes back to Sonora.

## API

- `GET /health`
- `GET /diagnostics`
- `GET /audio/:videoId`

Set `SONORA_AUDIO_API_KEY` or `AUDIO_SERVICE_API_KEY` to require `Authorization: Bearer <key>`.

## Environment

- `PORT=8080`
- `AUDIO_MAX_CONCURRENT=2`
- `AUDIO_REQUEST_TIMEOUT_MS=300000`
- `AUDIO_BITRATE=128K`
- `YOUTUBE_COOKIES_FILE=/run/secrets/youtube-cookies.txt`
- `SONORA_AUDIO_API_KEY=`
- `YTDLP_BIN=yt-dlp`
- `FFMPEG_LOCATION=`
- `BGUTIL_SERVER_HOME=/opt/bgutil-ytdlp-pot-provider/server`

## Local

Install `yt-dlp` and `ffmpeg` on your machine, then:

```bash
npm install
npm start
```

## Docker

```bash
docker build -t sonora-audio-service services/audio
docker run --rm -p 8080:8080 -e AUDIO_MAX_CONCURRENT=2 sonora-audio-service
```
