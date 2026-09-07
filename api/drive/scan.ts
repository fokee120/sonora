import { createHash } from 'node:crypto';

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
};

type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void };
};

type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  thumbnailLink?: string;
  iconLink?: string;
};

const AUDIO_EXTENSIONS = /\.(mp3|m4a|flac|wav|aac|ogg|opus)$/i;

function isAudioFile(file: DriveFile): boolean {
  const mimeType = String(file.mimeType || '').toLowerCase();
  return mimeType.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name || '');
}

function detectFormat(filename: string, mimeType?: string): string {
  const ext = filename.split('.').pop()?.toUpperCase();
  if (ext && ['MP3', 'M4A', 'FLAC', 'WAV', 'AAC', 'OGG', 'OPUS'].includes(ext)) return ext;
  if (mimeType?.includes('mpeg') || mimeType?.includes('mp3')) return 'MP3';
  if (mimeType?.includes('m4a') || mimeType?.includes('mp4')) return 'M4A';
  if (mimeType?.includes('flac')) return 'FLAC';
  if (mimeType?.includes('wav')) return 'WAV';
  if (mimeType?.includes('ogg')) return 'OGG';
  if (mimeType?.includes('opus')) return 'OPUS';
  return 'AUDIO';
}

function parseFilename(filename: string) {
  const cleanName = filename.replace(AUDIO_EXTENSIONS, '').trim();
  const matchArtistTitle = cleanName.match(/^(.+)\s+[-–—]\s+(.+)$/);
  if (matchArtistTitle) {
    return {
      artist: matchArtistTitle[2].trim() || 'Unknown Artist',
      title: matchArtistTitle[1].trim() || cleanName,
      album: 'Google Drive Audio',
    };
  }

  return {
    artist: 'Unknown Artist',
    title: cleanName || filename,
    album: 'Google Drive Audio',
  };
}

function makeAlbumId(title: string, artist: string) {
  return `gdrive-album-${createHash('sha256').update(`${title}:${artist}`).digest('hex').slice(0, 24)}`;
}

function makeArtistId(name: string) {
  return `gdrive-artist-${createHash('sha256').update(name).digest('hex').slice(0, 24)}`;
}

async function listDriveFiles(accessToken: string, folderId?: string): Promise<DriveFile[]> {
  let query = "trashed = false and mimeType != 'application/vnd.google-apps.folder'";
  if (folderId) query += ` and '${folderId}' in parents`;

  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const driveUrl = new URL('https://www.googleapis.com/drive/v3/files');
    driveUrl.searchParams.set('q', query);
    driveUrl.searchParams.set('fields', 'nextPageToken, files(id, name, mimeType, size, modifiedTime, thumbnailLink, iconLink)');
    driveUrl.searchParams.set('pageSize', '1000');
    driveUrl.searchParams.set('includeItemsFromAllDrives', 'true');
    driveUrl.searchParams.set('supportsAllDrives', 'true');
    if (pageToken) driveUrl.searchParams.set('pageToken', pageToken);

    const listRes = await fetch(driveUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!listRes.ok) {
      const errorText = await listRes.text();
      throw new Error(`Google Drive API error (${listRes.status}): ${errorText}`);
    }

    const listData = await listRes.json();
    files.push(...(listData.files || []));
    pageToken = listData.nextPageToken;
  } while (pageToken);

  return files;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    const tokenFromHeader = typeof authHeader === 'string'
      ? authHeader.replace(/^Bearer\s+/i, '').trim()
      : '';
    const accessToken = req.body?.accessToken || tokenFromHeader;
    const folderId = req.body?.folderId;

    if (!accessToken) {
      return res.status(401).json({
        error: 'Google Drive access token is required. Please disconnect and sign in with Google Drive again.',
      });
    }

    const driveFiles = await listDriveFiles(accessToken, folderId);
    const audioFiles = driveFiles.filter(isAudioFile);

    const tracks = audioFiles.map((file, index) => {
      const parsed = parseFilename(file.name || 'Unknown Track');
      return {
        id: `gdrive:${file.id}`,
        title: parsed.title,
        artist: parsed.artist,
        album: parsed.album,
        albumArtist: parsed.artist,
        trackNumber: index + 1,
        discNumber: 1,
        duration: 0,
        metadataKey: `${file.modifiedTime || ''}:${file.size || ''}`,
        artworkUrl: file.thumbnailLink || undefined,
        cloudKey: `gdrive://${file.id}/${encodeURIComponent(file.name || 'audio')}`,
        sizeBytes: Number(file.size || 0),
        format: detectFormat(file.name || '', file.mimeType),
      };
    });

    const albumMap = new Map<string, any>();
    const artistMap = new Map<string, any>();

    for (const track of tracks) {
      const albumKey = `${track.album.toLowerCase()}:::${track.albumArtist.toLowerCase()}`;
      if (!albumMap.has(albumKey)) {
        albumMap.set(albumKey, {
          id: makeAlbumId(track.album, track.albumArtist),
          title: track.album,
          artist: track.albumArtist,
          artworkUrl: track.artworkUrl,
          trackCount: 0,
          duration: 0,
          tracks: [],
        });
      }
      const album = albumMap.get(albumKey);
      album.tracks.push(track);
      album.trackCount += 1;
      album.duration += track.duration || 0;
      if (!album.artworkUrl && track.artworkUrl) album.artworkUrl = track.artworkUrl;

      const artistKey = track.artist.toLowerCase();
      if (!artistMap.has(artistKey)) {
        artistMap.set(artistKey, {
          id: makeArtistId(track.artist),
          name: track.artist,
          artworkUrl: track.artworkUrl,
          trackCount: 0,
          albumCount: 0,
        });
      }
      const artist = artistMap.get(artistKey);
      artist.trackCount += 1;
      artist.albumCount = 1;
      if (!artist.artworkUrl && track.artworkUrl) artist.artworkUrl = track.artworkUrl;
    }

    return res.status(200).json({
      tracks,
      albums: Array.from(albumMap.values()),
      artists: Array.from(artistMap.values()),
      source: 'google_drive',
      totalCount: tracks.length,
      scannedAt: new Date().toISOString(),
      debug: {
        visibleFiles: driveFiles.length,
        audioFiles: audioFiles.length,
        sampleFiles: driveFiles.slice(0, 10).map((file) => ({
          name: String(file.name || ''),
          mimeType: file.mimeType ? String(file.mimeType) : undefined,
        })),
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'Failed to scan Google Drive audio files',
      details: err?.message || String(err),
    });
  }
}
