import * as musicMetadata from 'music-metadata';
import { Track, Album, Artist } from '../../types/index.js';

export interface DriveScanResult {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  source: 'google_drive';
  totalCount: number;
  scannedAt: string;
  debug?: {
    visibleFiles: number;
    audioFiles: number;
    sampleFiles: { name: string; mimeType?: string }[];
  };
}

export class DriveMusicService {
  /**
   * Scan Google Drive for audio files (MP3, M4A, FLAC, WAV) and extract their metadata.
   */
  public async scanDriveMusic(accessToken: string, folderId?: string): Promise<DriveScanResult> {
    if (!accessToken) {
      throw new Error('Access token is required to scan Google Drive');
    }

    let query = "trashed = false and mimeType != 'application/vnd.google-apps.folder'";
    if (folderId) {
      query += ` and '${folderId}' in parents`;
    }

    const driveFiles: any[] = [];
    let pageToken: string | undefined;

    do {
      const driveUrl = new URL('https://www.googleapis.com/drive/v3/files');
      driveUrl.searchParams.set('q', query);
      driveUrl.searchParams.set('fields', 'nextPageToken, files(id, name, mimeType, size, modifiedTime, thumbnailLink, iconLink, parents)');
      driveUrl.searchParams.set('pageSize', '1000');
      driveUrl.searchParams.set('includeItemsFromAllDrives', 'true');
      driveUrl.searchParams.set('supportsAllDrives', 'true');
      if (pageToken) {
        driveUrl.searchParams.set('pageToken', pageToken);
      }

      const listRes = await fetch(driveUrl.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!listRes.ok) {
        const errorText = await listRes.text();
        throw new Error(`Google Drive API error (${listRes.status}): ${errorText}`);
      }

      const listData = await listRes.json();
      driveFiles.push(...(listData.files || []));
      pageToken = listData.nextPageToken;
    } while (pageToken);

    const audioFiles = driveFiles.filter((file) => this.isAudioFile(file));
    const debug = this.createDebugInfo(driveFiles, audioFiles);

    if (audioFiles.length === 0) {
      return {
        tracks: [],
        albums: [],
        artists: [],
        source: 'google_drive',
        totalCount: 0,
        scannedAt: new Date().toISOString(),
        debug,
      };
    }

    const tracks: Track[] = [];

    // Process files in concurrency batches of 5 to avoid rate limits
    const BATCH_SIZE = 5;
    for (let i = 0; i < audioFiles.length; i += BATCH_SIZE) {
      const batch = audioFiles.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((file) => this.extractMetadataFromDriveFile(file, accessToken))
      );
      tracks.push(...batchResults);
    }

    // Organize into Albums and Artists
    const { albums, artists } = this.organizeIntoAlbumsAndArtists(tracks);

    return {
      tracks,
      albums,
      artists,
      source: 'google_drive',
      totalCount: tracks.length,
      scannedAt: new Date().toISOString(),
      debug,
    };
  }

  private createDebugInfo(driveFiles: any[], audioFiles: any[]) {
    return {
      visibleFiles: driveFiles.length,
      audioFiles: audioFiles.length,
      sampleFiles: driveFiles.slice(0, 10).map((file) => ({
        name: String(file.name || ''),
        mimeType: file.mimeType ? String(file.mimeType) : undefined,
      })),
    };
  }

  private isAudioFile(file: any): boolean {
    const name = String(file.name || '').trim();
    const mimeType = String(file.mimeType || '').toLowerCase();

    return (
      mimeType.startsWith('audio/') ||
      /\.(mp3|m4a|flac|wav|aac|ogg|opus)$/i.test(name)
    );
  }

  /**
   * Fetch the first 128KB of an MP3/audio file from Google Drive via HTTP Range header
   * and parse its ID3v2 metadata (Artist, Album, Title, Track No, Artwork, Duration).
   */
  private async extractMetadataFromDriveFile(file: any, accessToken: string): Promise<Track> {
    const rawName = file.name || 'Unknown Track';
    const fallbackParsed = this.parseFallbackFromFilename(rawName);

    let title = fallbackParsed.title;
    let artist = fallbackParsed.artist;
    let album = fallbackParsed.album;
    let albumArtist = fallbackParsed.artist;
    let trackNumber = fallbackParsed.trackNumber || 1;
    let discNumber = 1;
    let duration = 180; // default estimated 3 minutes
    let year: number | undefined;
    let genre: string | undefined;
    let artworkUrl: string | undefined = file.thumbnailLink || undefined;

    try {
      // Request first 128KB to parse ID3 tags
      const mediaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Range: 'bytes=0-131071',
        },
      });

      if (mediaRes.ok || mediaRes.status === 206) {
        const arrayBuffer = await mediaRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        try {
          const parsedMeta = await musicMetadata.parseBuffer(buffer, {
            mimeType: file.mimeType || 'audio/mpeg',
            size: Number(file.size || 0),
          });

          if (parsedMeta.common.title) {
            title = parsedMeta.common.title.trim();
          }
          if (parsedMeta.common.artist) {
            artist = parsedMeta.common.artist.trim();
          }
          if (parsedMeta.common.album) {
            album = parsedMeta.common.album.trim();
          }
          if (parsedMeta.common.albumartist) {
            albumArtist = parsedMeta.common.albumartist.trim();
          } else if (artist) {
            albumArtist = artist;
          }
          if (parsedMeta.common.track?.no) {
            trackNumber = parsedMeta.common.track.no;
          }
          if (parsedMeta.common.disk?.no) {
            discNumber = parsedMeta.common.disk.no;
          }
          if (parsedMeta.common.year) {
            year = parsedMeta.common.year;
          }
          if (parsedMeta.common.genre && parsedMeta.common.genre.length > 0) {
            genre = parsedMeta.common.genre[0];
          }
          if (parsedMeta.format.duration && parsedMeta.format.duration > 0) {
            duration = Math.round(parsedMeta.format.duration);
          }

          // Embedded Album Artwork
          if (parsedMeta.common.picture && parsedMeta.common.picture.length > 0) {
            const pic = parsedMeta.common.picture[0];
            const base64Pic = Buffer.from(pic.data).toString('base64');
            artworkUrl = `data:${pic.format};base64,${base64Pic}`;
          }
        } catch {
          // Metadata parse of chunk failed, use fallback
        }
      }
    } catch (err) {
      console.warn(`Could not range-fetch metadata for file ${file.id} (${rawName}):`, err);
    }

    return {
      id: file.id,
      title,
      artist,
      album,
      albumArtist: albumArtist || artist,
      trackNumber,
      discNumber,
      duration,
      year,
      genre,
      artworkUrl: artworkUrl || undefined,
      cloudKey: `gdrive://${file.id}/${encodeURIComponent(rawName)}`,
      sizeBytes: Number(file.size || 0),
      format: this.detectFormat(rawName, file.mimeType),
    };
  }

  /**
   * Parse artist, album, track number, and title from common filename patterns:
   * "01 - Artist - Song.mp3", "Artist - Song.mp3", "01. Song.mp3"
   */
  private parseFallbackFromFilename(filename: string): {
    title: string;
    artist: string;
    album: string;
    trackNumber?: number;
  } {
    // Remove extension
    const cleanName = filename.replace(/\.(mp3|m4a|flac|wav|aac|ogg|opus)$/i, '').trim();

    let trackNumber: number | undefined;
    let artist = 'Unknown Artist';
    let album = 'Google Drive Audio';
    let title = cleanName;

    // Pattern: "01 - Artist - Title"
    const matchTrackArtistTitle = cleanName.match(/^(\d{1,2})\s*[-._]\s*(.+?)\s*[-._]\s*(.+)$/);
    if (matchTrackArtistTitle) {
      trackNumber = parseInt(matchTrackArtistTitle[1], 10);
      artist = matchTrackArtistTitle[2].trim();
      title = matchTrackArtistTitle[3].trim();
      return { title, artist, album, trackNumber };
    }

    // Pattern: "01 - Title" or "01. Title"
    const matchTrackTitle = cleanName.match(/^(\d{1,2})\s*[-._]\s*(.+)$/);
    if (matchTrackTitle) {
      trackNumber = parseInt(matchTrackTitle[1], 10);
      title = matchTrackTitle[2].trim();
      return { title, artist, album, trackNumber };
    }

    // Pattern: "Artist - Title"
    const matchArtistTitle = cleanName.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (matchArtistTitle) {
      artist = matchArtistTitle[1].trim();
      title = matchArtistTitle[2].trim();
      return { title, artist, album, trackNumber };
    }

    return { title, artist, album, trackNumber };
  }

  private detectFormat(filename: string, mimeType?: string): string {
    const ext = filename.split('.').pop()?.toUpperCase();
    if (ext && ['MP3', 'M4A', 'FLAC', 'WAV', 'AAC', 'OGG', 'OPUS'].includes(ext)) {
      return ext;
    }
    if (mimeType?.includes('mpeg') || mimeType?.includes('mp3')) return 'MP3';
    if (mimeType?.includes('m4a') || mimeType?.includes('mp4')) return 'M4A';
    if (mimeType?.includes('flac')) return 'FLAC';
    if (mimeType?.includes('wav')) return 'WAV';
    if (mimeType?.includes('ogg')) return 'OGG';
    if (mimeType?.includes('opus')) return 'OPUS';
    return 'AUDIO';
  }

  /**
   * Group flat tracks into structured Album and Artist entities.
   */
  private organizeIntoAlbumsAndArtists(tracks: Track[]): {
    albums: Album[];
    artists: Artist[];
  } {
    const albumMap = new Map<string, { album: Album; tracks: Track[] }>();
    const artistMap = new Map<string, { artist: Artist; albumTitles: Set<string>; trackIds: Set<string> }>();

    for (const track of tracks) {
      const albumKey = `${(track.album || 'Unknown Album').toLowerCase()}:::${(track.albumArtist || track.artist || 'Unknown Artist').toLowerCase()}`;
      const albumId = `album-${Buffer.from(albumKey).toString('base64url').slice(0, 24)}`;

      if (!albumMap.has(albumKey)) {
        albumMap.set(albumKey, {
          album: {
            id: albumId,
            title: track.album || 'Unknown Album',
            artist: track.albumArtist || track.artist || 'Unknown Artist',
            year: track.year,
            genre: track.genre,
            artworkUrl: track.artworkUrl,
            trackCount: 0,
            duration: 0,
            tracks: [],
          },
          tracks: [],
        });
      }

      const entry = albumMap.get(albumKey)!;
      entry.tracks.push(track);
      entry.album.trackCount += 1;
      entry.album.duration += track.duration || 0;
      if (!entry.album.artworkUrl && track.artworkUrl) {
        entry.album.artworkUrl = track.artworkUrl;
      }

      // Artist map
      const artistName = track.artist || 'Unknown Artist';
      const artistKey = artistName.toLowerCase();
      const artistId = `artist-${Buffer.from(artistKey).toString('base64url').slice(0, 24)}`;

      if (!artistMap.has(artistKey)) {
        artistMap.set(artistKey, {
          artist: {
            id: artistId,
            name: artistName,
            artworkUrl: track.artworkUrl,
            trackCount: 0,
            albumCount: 0,
          },
          albumTitles: new Set(),
          trackIds: new Set(),
        });
      }

      const aEntry = artistMap.get(artistKey)!;
      aEntry.trackIds.add(track.id);
      aEntry.albumTitles.add(track.album || 'Unknown Album');
      aEntry.artist.trackCount = aEntry.trackIds.size;
      aEntry.artist.albumCount = aEntry.albumTitles.size;
      if (!aEntry.artist.artworkUrl && track.artworkUrl) {
        aEntry.artist.artworkUrl = track.artworkUrl;
      }
    }

    // Sort tracks inside each album by trackNumber
    const albums: Album[] = [];
    for (const entry of albumMap.values()) {
      entry.tracks.sort((a, b) => (a.trackNumber || 1) - (b.trackNumber || 1));
      entry.album.tracks = entry.tracks;
      albums.push(entry.album);
    }
    albums.sort((a, b) => a.title.localeCompare(b.title));

    const artists: Artist[] = [];
    for (const aEntry of artistMap.values()) {
      artists.push(aEntry.artist);
    }
    artists.sort((a, b) => a.name.localeCompare(b.name));

    return { albums, artists };
  }
}
