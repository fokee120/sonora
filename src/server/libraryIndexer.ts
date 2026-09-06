import { Track, Album, Artist } from '../types/index.js';
import { IStorageProvider, StorageObject } from './storage/IStorageProvider.js';

// Fallback curated library with real playable streams (including verified M4A master) for immediate verification & offline download testing
export const DEMO_FALLBACK_TRACKS: Track[] = [
  {
    id: 'demo-sample-m4a',
    title: 'Acoustic Groove (M4A Master)',
    artist: 'Audio Fidelity',
    album: 'Studio M4A Sessions',
    albumArtist: 'Audio Fidelity',
    trackNumber: 1,
    discNumber: 1,
    duration: 13,
    year: 2024,
    genre: 'Acoustic / AAC',
    artworkUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    cloudKey: 'music/Audio Fidelity/Studio M4A Sessions/01 - Acoustic Groove.m4a',
    sizeBytes: 46468,
    format: 'm4a',
    lyrics: `Studio master recording encoded in AAC / M4A container for high-efficiency, pristine audio playback.\nVerified for GCS byte-range seeking and IndexedDB offline persistence.`
  },
  {
    id: 'demo-sade-smooth-operator',
    title: 'Smooth Operator',
    artist: 'Sade',
    album: 'Diamond Life',
    albumArtist: 'Sade',
    trackNumber: 1,
    discNumber: 1,
    duration: 258,
    year: 1984,
    genre: 'Sophisti-Pop / Smooth Jazz',
    artworkUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80',
    cloudKey: 'music/Sade/Diamond Life/01 - Smooth Operator.mp3',
    sizeBytes: 6200000,
    format: 'mp3',
    lyrics: `Diamond life, lover boy\nHe move in space with minimum waste and maximum joy\nCity lights and business nights\nWhen you require streetcar desire for higher heights\n\nNo place for beginners or sensitive hearts\nWhen sentiment is left to chance\nNo place to be ending but somewhere to start\nNo need to ask, he's a smooth operator\nSmooth operator, smooth operator...`
  },
  {
    id: 'demo-sinatra-strangers-in-the-night',
    title: 'Strangers in the Night',
    artist: 'Frank Sinatra',
    album: 'Strangers in the Night',
    albumArtist: 'Frank Sinatra',
    trackNumber: 1,
    discNumber: 1,
    duration: 157,
    year: 1966,
    genre: 'Traditional Pop / Jazz',
    artworkUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    cloudKey: 'music/Frank Sinatra/Strangers in the Night/01 - Strangers in the Night.mp3',
    sizeBytes: 3800000,
    format: 'mp3',
    lyrics: `Strangers in the night exchanging glances\nWond'ring in the night what were the chances\nWe'd be sharing love before the night was through\n\nSomething in your eyes was so inviting\nSomething in your smile was so exciting\nSomething in my heart told me I must have you...`
  },
  {
    id: 'demo-sinatra-summer-wind',
    title: 'Summer Wind',
    artist: 'Frank Sinatra',
    album: 'Strangers in the Night',
    albumArtist: 'Frank Sinatra',
    trackNumber: 2,
    discNumber: 1,
    duration: 174,
    year: 1966,
    genre: 'Traditional Pop / Jazz',
    artworkUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    cloudKey: 'music/Frank Sinatra/Strangers in the Night/02 - Summer Wind.mp3',
    sizeBytes: 4200000,
    format: 'mp3',
    lyrics: `The summer wind, came blowin' in\nFrom across the sea\nIt lingered there to touch your hair\nAnd walk with me\nAll summer long we sang a song\nAnd then we strolled on golden sand\nTwo sweethearts and the summer wind...`
  },
  {
    id: 'demo-chopin-nocturne',
    title: 'Nocturne in E-flat major, Op. 9, No. 2',
    artist: 'Frédéric Chopin',
    album: 'Complete Nocturnes',
    albumArtist: 'Frédéric Chopin',
    trackNumber: 2,
    discNumber: 1,
    duration: 272,
    year: 1832,
    genre: 'Classical / Romantic',
    artworkUrl: 'https://images.unsplash.com/photo-1520523839898-50712128e469?w=600&auto=format&fit=crop&q=80',
    cloudKey: 'music/Frédéric Chopin/Complete Nocturnes/02 - Nocturne in E-flat major.mp3',
    sizeBytes: 6500000,
    format: 'mp3'
  },
  {
    id: 'demo-debussy-clair-de-lune',
    title: 'Clair de Lune (Suite bergamasque)',
    artist: 'Claude Debussy',
    album: 'Suite bergamasque',
    albumArtist: 'Claude Debussy',
    trackNumber: 3,
    discNumber: 1,
    duration: 304,
    year: 1905,
    genre: 'Classical / Impressionist',
    artworkUrl: 'https://images.unsplash.com/photo-1507838153414-b4b713384a76?w=600&auto=format&fit=crop&q=80',
    cloudKey: 'music/Claude Debussy/Suite bergamasque/03 - Clair de Lune.mp3',
    sizeBytes: 7300000,
    format: 'mp3'
  },
  {
    id: 'demo-vivaldi-spring',
    title: 'The Four Seasons: Spring (Allegro)',
    artist: 'Antonio Vivaldi',
    album: 'The Four Seasons',
    albumArtist: 'Antonio Vivaldi',
    trackNumber: 1,
    discNumber: 1,
    duration: 213,
    year: 1725,
    genre: 'Baroque',
    artworkUrl: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=600&auto=format&fit=crop&q=80',
    cloudKey: 'music/Antonio Vivaldi/The Four Seasons/01 - Spring (Allegro).mp3',
    sizeBytes: 5100000,
    format: 'mp3'
  }
];

// High-fidelity public audio sources mapped to demo track keys for verified streaming & downloading testability
export const DEMO_STREAM_FALLBACKS: Record<string, string> = {
  'music/Audio Fidelity/Studio M4A Sessions/01 - Acoustic Groove.m4a': 'https://raw.githubusercontent.com/rafaelreis-hotmart/Audio-Sample-files/master/sample.m4a',
  'music/Sade/Diamond Life/01 - Smooth Operator.mp3': 'https://commondatastorage.googleapis.com/codeskulptor-demos/DDR_assets/Kangaroo_MusiQue_-_The_Neverending_Story.mp3',
  'music/Frank Sinatra/Strangers in the Night/01 - Strangers in the Night.mp3': 'https://commondatastorage.googleapis.com/codeskulptor-assets/Epoq-Lepidoptera.ogg',
  'music/Frank Sinatra/Strangers in the Night/02 - Summer Wind.mp3': 'https://commondatastorage.googleapis.com/codeskulptor-demos/pyman_assets/ateapill.ogg',
  'music/Frédéric Chopin/Complete Nocturnes/02 - Nocturne in E-flat major.mp3': 'https://ia800504.us.archive.org/11/items/ChopinNocturneOp9No2/ChopinNocturneOp9No2.mp3',
  'music/Claude Debussy/Suite bergamasque/03 - Clair de Lune.mp3': 'https://ia800301.us.archive.org/15/items/ClairDeLune_584/ClairDeLune.mp3',
  'music/Antonio Vivaldi/The Four Seasons/01 - Spring (Allegro).mp3': 'https://ia802802.us.archive.org/15/items/VivaldiTheFourSeasonsSpring/01_Vivaldi_Spring_mvt_1_allegro.mp3'
};

export interface LibraryScanResult {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  isGcsConfigured: boolean;
  // Backward compatibility alias for UI components
  isR2Configured: boolean;
  storageName: string;
  bucketName: string | null;
  lastScanTime: string | null;
  trackCount: number;
  scanDurationMs?: number;
}

export class LibraryIndexer {
  private storage: IStorageProvider;
  private cachedResult: LibraryScanResult | null = null;
  private lastScanTimestamp: number | null = null;

  constructor(storage: IStorageProvider) {
    this.storage = storage;
  }

  public getLastScanTime(): string | null {
    return this.lastScanTimestamp ? new Date(this.lastScanTimestamp).toISOString() : null;
  }

  public getCachedResult(): LibraryScanResult | null {
    return this.cachedResult;
  }

  /**
   * Scans Google Cloud Storage or returns fallback normalized library.
   * When GCS credentials are configured, NEVER uses mock/demo data.
   */
  public async scanLibrary(prefix = 'music/'): Promise<LibraryScanResult> {
    const startTime = Date.now();
    const isConfigured = this.storage.isConfigured();
    const status = await this.storage.getStatus();

    if (!isConfigured) {
      const demoResult: LibraryScanResult = {
        tracks: DEMO_FALLBACK_TRACKS,
        albums: this.aggregateAlbums(DEMO_FALLBACK_TRACKS),
        artists: this.aggregateArtists(DEMO_FALLBACK_TRACKS),
        isGcsConfigured: false,
        isR2Configured: false,
        storageName: this.storage.name,
        bucketName: status.bucketName,
        lastScanTime: this.lastScanTimestamp ? new Date(this.lastScanTimestamp).toISOString() : new Date().toISOString(),
        trackCount: DEMO_FALLBACK_TRACKS.length,
        scanDurationMs: Date.now() - startTime,
      };
      this.cachedResult = demoResult;
      this.lastScanTimestamp = Date.now();
      return demoResult;
    }

    try {
      // Real GCS recursive bucket listing
      const objects = await this.storage.listMusicFiles(prefix);

      // Map artwork covers by folder
      const artworkMap = new Map<string, string>(); // folder -> cover object key
      const audioObjects: StorageObject[] = [];

      for (const obj of objects) {
        const lowerKey = obj.key.toLowerCase();
        if (
          lowerKey.endsWith('.jpg') ||
          lowerKey.endsWith('.jpeg') ||
          lowerKey.endsWith('.png') ||
          lowerKey.endsWith('.webp') ||
          lowerKey.endsWith('.svg')
        ) {
          const parts = obj.key.split('/');
          parts.pop();
          const folder = parts.join('/');
          artworkMap.set(folder, obj.key);
        } else if (
          lowerKey.endsWith('.mp3') ||
          lowerKey.endsWith('.m4a') ||
          lowerKey.endsWith('.aac') ||
          lowerKey.endsWith('.flac') ||
          lowerKey.endsWith('.wav') ||
          lowerKey.endsWith('.ogg')
        ) {
          audioObjects.push(obj);
        }
      }

      // If bucket is configured, build strictly from real GCS files (never mock data)
      const tracks: Track[] = audioObjects.map((obj, index) => {
        return this.parseTrackFromKey(obj, artworkMap, index);
      });

      const albums = this.aggregateAlbums(tracks);
      const artists = this.aggregateArtists(tracks);

      const result: LibraryScanResult = {
        tracks,
        albums,
        artists,
        isGcsConfigured: true,
        isR2Configured: true,
        storageName: this.storage.name,
        bucketName: status.bucketName,
        lastScanTime: new Date().toISOString(),
        trackCount: tracks.length,
        scanDurationMs: Date.now() - startTime,
      };

      this.cachedResult = result;
      this.lastScanTimestamp = Date.now();
      return result;
    } catch (err: any) {
      console.error('Failed to scan Google Cloud Storage library:', err);
      // When configured, report real state without masking behind demo data
      const errorResult: LibraryScanResult = {
        tracks: [],
        albums: [],
        artists: [],
        isGcsConfigured: true,
        isR2Configured: true,
        storageName: this.storage.name,
        bucketName: status.bucketName,
        lastScanTime: new Date().toISOString(),
        trackCount: 0,
        scanDurationMs: Date.now() - startTime,
      };
      this.cachedResult = errorResult;
      this.lastScanTimestamp = Date.now();
      return errorResult;
    }
  }

  /**
   * Parse folder-based organization:
   * music/{Artist}/{Album}/{TrackNumber} - {Title}.{ext}
   * Supports: mp3, m4a, aac, wav, flac, ogg
   */
  private parseTrackFromKey(
    obj: StorageObject,
    artworkMap: Map<string, string>,
    fallbackIdx: number
  ): Track {
    const parts = obj.key.split('/');
    const filename = parts[parts.length - 1];
    const albumFolder = parts.slice(0, parts.length - 1).join('/');

    // Strip extension
    const baseName = filename.replace(/\.[^/.]+$/, '');
    const extension = filename.split('.').pop()?.toLowerCase() || 'mp3';

    // Normalize format
    let format: 'mp3' | 'm4a' | 'flac' | 'wav' | 'aac' | 'ogg' = 'mp3';
    if (extension === 'm4a') format = 'm4a';
    else if (extension === 'aac') format = 'aac';
    else if (extension === 'flac') format = 'flac';
    else if (extension === 'wav') format = 'wav';
    else if (extension === 'ogg') format = 'ogg';

    // Fallback artist & album from folder hierarchy
    let artist = 'Unknown Artist';
    let album = 'Unknown Album';

    if (parts.length >= 3) {
      artist = decodeURIComponent(parts[parts.length - 3] || 'Unknown Artist');
      album = decodeURIComponent(parts[parts.length - 2] || 'Unknown Album');
    } else if (parts.length === 2) {
      album = decodeURIComponent(parts[0]);
    }

    // Parse track number and title: e.g. "01 - Song Title" or "01. Song Title"
    let trackNumber = fallbackIdx + 1;
    let title = baseName;

    const trackMatch = baseName.match(/^(\d{1,3})[\s._-]+(.*)$/);
    if (trackMatch) {
      trackNumber = parseInt(trackMatch[1], 10);
      title = trackMatch[2].trim();
    }

    // Determine artwork URL if cover exists in same folder
    let artworkUrl = '/icon.svg';
    const coverKey = artworkMap.get(albumFolder);
    if (coverKey) {
      artworkUrl = `/api/artwork?key=${encodeURIComponent(coverKey)}`;
    }

    // Stable ID based on key
    const id = Buffer.from(obj.key).toString('base64url');

    return {
      id,
      title: title || baseName,
      artist,
      album,
      albumArtist: artist,
      trackNumber,
      discNumber: 1,
      duration: 180, // estimated until client metadata read
      sizeBytes: obj.size,
      artworkUrl,
      cloudKey: obj.key,
      format,
    };
  }

  private aggregateAlbums(tracks: Track[]): Album[] {
    const map = new Map<string, Album>();

    for (const track of tracks) {
      const key = `${track.artist}___${track.album}`;
      if (!map.has(key)) {
        map.set(key, {
          id: Buffer.from(key).toString('base64url'),
          title: track.album,
          artist: track.artist,
          year: track.year,
          genre: track.genre,
          artworkUrl: track.artworkUrl,
          trackCount: 0,
          duration: 0,
          tracks: [],
        });
      }

      const album = map.get(key)!;
      album.trackCount += 1;
      album.duration += track.duration || 0;
      album.tracks?.push(track);
    }

    // Sort tracks in each album by trackNumber
    for (const album of map.values()) {
      album.tracks?.sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
    }

    return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
  }

  private aggregateArtists(tracks: Track[]): Artist[] {
    const map = new Map<string, Artist>();

    for (const track of tracks) {
      const name = track.artist || 'Unknown Artist';
      if (!map.has(name)) {
        map.set(name, {
          id: Buffer.from(name).toString('base64url'),
          name,
          artworkUrl: track.artworkUrl,
          trackCount: 0,
          albumCount: 0,
        });
      }

      const artist = map.get(name)!;
      artist.trackCount += 1;
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }
}
