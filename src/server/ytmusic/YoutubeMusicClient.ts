/**
 * YouTube Music client (server-side)
 *
 * Uses YouTube Music's public InnerTube endpoints (the same ones the
 * music.youtube.com web app calls) to search the catalog and resolve
 * audio stream URLs. No API key or OAuth is required.
 *
 * Two capabilities are exposed:
 *  1. search(query, filter)       -> normalized catalog results (songs / videos)
 *  2. resolveAudioStream(videoId) -> direct audio-only stream URL + metadata
 */

const INNERTUBE_HOST = 'https://music.youtube.com';

/**
 * InnerTube client profiles. Tried in order when resolving streams.
 * The TV-embedded profile usually succeeds from datacenter IPs where
 * phone/desktop profiles get a bot-check; keep several for resilience.
 */
const PLAYER_CLIENTS: Array<{
  clientName: string;
  clientVersion: string;
  [key: string]: unknown;
}> = [
  {
    clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    clientVersion: '2.0',
    clientScreen: 'EMBED',
    thirdParty: { embedUrl: 'https://www.youtube.com' },
    hl: 'en',
    gl: 'US',
    userAgent:
      'Mozilla/5.0 (SMART-TV; LINUX; Tizen 4.0) AppleWebKit/537.36 (KHTML, like Gecko) Version 8.0 TV Safari/537.36',
  },
  {
    clientName: 'WEB_EMBEDDED_PLAYER',
    clientVersion: '1.20240401.01.00',
    clientScreen: 'EMBED',
    thirdParty: { embedUrl: 'https://www.youtube.com' },
    hl: 'en',
    gl: 'US',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  {
    clientName: 'ANDROID_MUSIC',
    clientVersion: '6.42.52',
    androidSdkVersion: 30,
    osName: 'Android',
    osVersion: '11',
    hl: 'en',
    gl: 'US',
    userAgent:
      'com.google.android.apps.youtube.music/6.42.52 (Linux; U; Android 11) gzip',
  },
  {
    clientName: 'ANDROID',
    clientVersion: '19.09.37',
    androidSdkVersion: 30,
    osName: 'Android',
    osVersion: '11',
    hl: 'en',
    gl: 'US',
    userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
  },
  {
    clientName: 'IOS',
    clientVersion: '19.29.1',
    deviceModel: 'iPhone16,2',
    osName: 'iOS',
    osVersion: '17.5.1.21F90',
    hl: 'en',
    gl: 'US',
    userAgent:
      'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)',
  },
  {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20240401.01.00',
    hl: 'en',
    gl: 'US',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
];

/** Search shelf filters (base64 protobuf params used by music.youtube.com). */
export type YtmSearchFilter = 'songs' | 'videos' | 'albums' | 'artists';

const SEARCH_FILTER_PARAMS: Record<YtmSearchFilter, string> = {
  songs: 'EgWKAQIIAWoKEAkQBRAKEAMQBA==',
  videos: 'EgWKAQIQAWoKEAkQChAFEAMQBA==',
  albums: 'EgWKAQIYAWoKEAkQChAFEAMQBA==',
  artists: 'EgWKAQIgAWoKEAkQChAFEAMQBA==',
};

export interface YtmSong {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  durationSeconds: number;
  durationText?: string;
  thumbnailUrl?: string;
  isVideo?: boolean;
}

export interface YtmSearchResult {
  query: string;
  filter: YtmSearchFilter;
  songs: YtmSong[];
}

export interface ResolvedAudioStream {
  videoId: string;
  url: string;
  mimeType: string;
  bitrate: number;
  contentLength: number;
  approxDurationMs?: number;
  itag?: number;
  clientUsed: string;
  expiresInSeconds: number;
}

interface JsonLike {
  [key: string]: any;
}

/**
 * Third-party stream resolver fallbacks (Piped-compatible APIs).
 * Used when every InnerTube client gets bot-blocked from this server IP.
 * Configure with PIPED_API_URL (comma-separated), otherwise a few known
 * public instances are attempted.
 */
const DEFAULT_PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.private.coffee',
  'https://pipedapi.reallyaweso.me',
  'https://pipedapi.ducks.party',
];

function firstRunText(node: JsonLike | undefined | null): string {
  const runs = node?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  if (Array.isArray(runs) && runs.length > 0) {
    return String(runs[0].text ?? '').trim();
  }
  return '';
}

function allRunTexts(node: JsonLike | undefined | null): string[] {
  const runs = node?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  if (Array.isArray(runs)) {
    return runs.map((r: JsonLike) => String(r?.text ?? '')).filter(Boolean);
  }
  return [];
}

function parseDurationToSeconds(text: string): number {
  if (!text) return 0;
  const parts = text.split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  let seconds = 0;
  for (const part of parts) {
    seconds = seconds * 60 + part;
  }
  return seconds;
}

function bestThumbnail(node: JsonLike | undefined | null): string | undefined {
  const thumbnails =
    node?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
    node?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
  if (Array.isArray(thumbnails) && thumbnails.length > 0) {
    // Highest resolution is typically the last entry.
    const sorted = [...thumbnails].sort(
      (a: JsonLike, b: JsonLike) => (b.width || 0) - (a.width || 0)
    );
    return sorted[0]?.url;
  }
  return undefined;
}

/** Common "noise" suffixes YouTube Music titles carry; strip for cleaner metadata. */
const TITLE_NOISE = [
  /\s*[\(\[](official\s+)?(music\s+)?video[\)\]]/gi,
  /\s*[\(\[]official\s+audio[\)\]]/gi,
  /\s*[\(\[](official\s+)?(lyric[s]?\s+)?video[\)\]]/gi,
  /\s*[\(\[]lyrics?[\)\]]/gi,
  /\s*[\(\[]audio[\)\]]/gi,
  /\s*[\(\[]visualizer[\)\]]/gi,
  /\s*[\(\[](hd|hq|4k)[\)\]]/gi,
];

export function cleanSongTitle(raw: string): string {
  let title = raw;
  for (const pattern of TITLE_NOISE) {
    title = title.replace(pattern, '');
  }
  return title.trim() || raw.trim();
}

function extractVideoId(renderer: JsonLike): string | undefined {
  const fromPlaylistItem = renderer?.playlistItemData?.videoId;
  if (typeof fromPlaylistItem === 'string' && fromPlaylistItem) return fromPlaylistItem;

  const fromOverlay =
    renderer?.overlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
  if (typeof fromOverlay === 'string' && fromOverlay) return fromOverlay;

  const fromNav =
    renderer?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text
      ?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
  if (typeof fromNav === 'string' && fromNav) return fromNav;

  return undefined;
}

function parseSongRenderer(renderer: JsonLike, shelfTitle: string): YtmSong | null {
  const videoId = extractVideoId(renderer);
  if (!videoId) return null;

  const flexColumns: JsonLike[] = renderer?.flexColumns ?? [];
  const rawTitle = firstRunText(flexColumns[0]);
  if (!rawTitle) return null;

  const secondColTexts = allRunTexts(flexColumns[1]);
  const isVideoShelf = /video/i.test(shelfTitle);

  let artist = 'Unknown Artist';
  let album: string | undefined;
  let durationText: string | undefined;

  if (isVideoShelf) {
    artist = secondColTexts[0] || 'YouTube';
    durationText = secondColTexts.find((t) => /^\d+(:\d{2})+$/.test(t));
  } else {
    // Songs shelf: second column runs read like "Artist • Album • 3:45"
    const tokens: string[] = [];
    let current = '';
    for (const t of secondColTexts) {
      if (t === ' • ') {
        tokens.push(current.trim());
        current = '';
      } else {
        current += t;
      }
    }
    if (current.trim()) tokens.push(current.trim());

    const durationIdx = tokens.findIndex((t) => /^\d+(:\d{2})+$/.test(t));
    if (durationIdx >= 0) {
      durationText = tokens[durationIdx];
      tokens.splice(durationIdx, 1);
    }
    if (tokens.length > 0) artist = tokens[0];
    if (tokens.length > 1) album = tokens[1];
  }

  return {
    videoId,
    title: cleanSongTitle(rawTitle),
    artist,
    album,
    durationSeconds: parseDurationToSeconds(durationText || ''),
    durationText,
    thumbnailUrl:
      bestThumbnail(renderer) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    isVideo: isVideoShelf,
  };
}

export class YoutubeMusicClient {
  private apiKey: string;
  private visitorData: string | null = null;

  constructor() {
    // Public web key used by music.youtube.com itself.
    this.apiKey = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
  }

  private async innertubePost(
    endpoint: string,
    body: JsonLike,
    clientIndex = 0
  ): Promise<JsonLike> {
    const client = PLAYER_CLIENTS[clientIndex] ?? PLAYER_CLIENTS[0];
    const url = `${INNERTUBE_HOST}/youtubei/v1/${endpoint}?key=${this.apiKey}&prettyPrint=false`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': String(client.userAgent ?? ''),
          'Accept-Language': 'en-US,en;q=0.9',
          Origin: INNERTUBE_HOST,
          Referer: `${INNERTUBE_HOST}/`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`InnerTube ${endpoint} failed: HTTP ${res.status}`);
      }
      const json = (await res.json()) as JsonLike;
      // Remember visitorData — reusing it improves player-endpoint reliability.
      const visitor = json?.responseContext?.visitorData;
      if (typeof visitor === 'string' && visitor) {
        this.visitorData = visitor;
      }
      return json;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Search the YouTube Music catalog. */
  public async search(
    query: string,
    filter: YtmSearchFilter = 'songs'
  ): Promise<YtmSearchResult> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { query: trimmed, filter, songs: [] };
    }

    const body: JsonLike = {
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: '1.20240401.01.00',
          hl: 'en',
          gl: 'US',
        },
      },
      query: trimmed,
    };

    if (SEARCH_FILTER_PARAMS[filter]) {
      body.params = SEARCH_FILTER_PARAMS[filter];
    }

    const data = await this.innertubePost('search', body);
    const songs: YtmSong[] = [];

    const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs ?? [];
    for (const tab of tabs) {
      const sectionList =
        tab?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
      for (const section of sectionList) {
        const shelf = section?.musicShelfRenderer;
        if (!shelf) continue;
        const shelfTitle = String(
          shelf?.title?.runs?.[0]?.text ?? shelf?.title?.simpleText ?? ''
        );

        const items: JsonLike[] = shelf?.contents ?? [];
        for (const item of items) {
          const renderer = item?.musicResponsiveListItemRenderer;
          if (!renderer) continue;
          const song = parseSongRenderer(renderer, shelfTitle);
          if (song && song.videoId) {
            songs.push(song);
          }
        }
      }
    }

    // De-duplicate by videoId
    const seen = new Set<string>();
    const unique = songs.filter((s) => {
      if (seen.has(s.videoId)) return false;
      seen.add(s.videoId);
      return true;
    });

    return { query: trimmed, filter, songs: unique };
  }

  /**
   * Fetch metadata for a single video. Tries multiple client profiles
   * because the plain WEB_REMIX player call is often bot-gated.
   */
  public async getTrack(videoId: string): Promise<YtmSong> {
    let lastError: Error | null = null;

    for (let i = 0; i < PLAYER_CLIENTS.length; i++) {
      try {
        const data = await this.innertubePost(
          'player',
          {
            context: { client: { ...PLAYER_CLIENTS[i] } },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          },
          i
        );

        const details = data?.videoDetails;
        if (!details || !details.videoId) {
          const reason = data?.playabilityStatus?.reason || data?.playabilityStatus?.status;
          throw new Error(reason || 'Track details unavailable');
        }

        const author: string = details.author || 'Unknown Artist';
        let artist = 'Unknown Artist';
        let album = 'YouTube Music';
        if (author.includes(' - Topic')) {
          artist = author.replace(/ - Topic$/, '');
        } else {
          const parts = author.split(' - ');
          if (parts.length >= 2) {
            artist = parts[0];
            album = parts.slice(1).join(' - ');
          } else {
            artist = author;
          }
        }

        const thumbnails: JsonLike[] = details?.thumbnail?.thumbnails ?? [];
        const best = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0))[0];

        return {
          videoId: details.videoId,
          title: cleanSongTitle(String(details.title || 'Unknown Title')),
          artist,
          album,
          durationSeconds: Math.round(Number(details.lengthSeconds || 0)),
          thumbnailUrl:
            best?.url || `https://i.ytimg.com/vi/${details.videoId}/hqdefault.jpg`,
        };
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError || new Error('Track not found on YouTube Music');
  }

  /**
   * Resolve a playable audio-only stream URL for a video.
   * Order: InnerTube client profiles -> Piped-compatible third-party APIs.
   */
  public async resolveAudioStream(videoId: string): Promise<ResolvedAudioStream> {
    let lastError: Error | null = null;

    for (let i = 0; i < PLAYER_CLIENTS.length; i++) {
      const client = PLAYER_CLIENTS[i];
      try {
        const contextClient: JsonLike = { ...client };
        if (this.visitorData) {
          contextClient.visitorData = this.visitorData;
        }

        const data = await this.innertubePost(
          'player',
          {
            context: { client: contextClient },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          },
          i
        );

        const playability = data?.playabilityStatus?.status;
        if (playability && playability !== 'OK') {
          const reason = data?.playabilityStatus?.reason || playability;
          throw new Error(`Playback blocked (${reason})`);
        }

        const formats: JsonLike[] = data?.streamingData?.adaptiveFormats ?? [];
        const audioFormats = formats.filter((f) => {
          const mime = String(f.mimeType || '');
          const hasUrl = Boolean(f.url);
          return mime.startsWith('audio/') && hasUrl;
        });

        if (audioFormats.length === 0) {
          throw new Error('No audio-only formats returned');
        }

        // Prefer browser-compatible AAC/MP4, then bitrate within that format.
        const best = [...audioFormats].sort(
          (a, b) => Number(String(b.mimeType).startsWith('audio/mp4')) - Number(String(a.mimeType).startsWith('audio/mp4')) || Number(b.bitrate || 0) - Number(a.bitrate || 0)
        )[0];

        let streamUrl: string | undefined = best.url;
        if (!streamUrl && best.signatureCipher) {
          // Ciphered formats require deciphering; these clients normally
          // return direct URLs, so treat this as unsupported rather than
          // attempting fragile JS deciphering.
          throw new Error('Audio format is cipher-protected for this client');
        }
        if (!streamUrl) throw new Error('No stream URL in response');

        const mimeType = String(best.mimeType || 'audio/mp4').split(';')[0];

        return {
          videoId,
          url: streamUrl,
          mimeType,
          bitrate: Number(best.bitrate || 0),
          contentLength: Number(best.contentLength || 0),
          approxDurationMs: Number(best.approxDurationMs || 0) || undefined,
          itag: Number(best.itag || 0) || undefined,
          clientUsed: String(client.clientName),
          expiresInSeconds: Number(data?.streamingData?.expiresInSeconds || 21540),
        };
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Try the next client profile
      }
    }

    // All InnerTube profiles failed — try third-party Piped-compatible APIs
    try {
      return await this.resolveAudioStreamViaPiped(videoId);
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    const hint =
      /bot|sign in/i.test(lastError?.message || '')
        ? ' — YouTube is bot-blocking this server IP. Configure Sonora Audio Service with SONORA_AUDIO_API_URL.'
        : '';
    throw new Error(`${lastError?.message || 'Could not resolve audio stream'}${hint}`);
  }

  /**
   * Fallback resolver using public/self-hosted Piped-compatible APIs.
   */
  private async resolveAudioStreamViaPiped(videoId: string): Promise<ResolvedAudioStream> {
    const configured = (process.env.PIPED_API_URL || '')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean);
    const instances = configured.length > 0 ? configured : DEFAULT_PIPED_INSTANCES;

    let lastError: Error | null = null;

    for (const base of instances) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(`${base}/streams/${encodeURIComponent(videoId)}`, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as JsonLike;
        const audioStreams: JsonLike[] = data?.audioStreams ?? [];
        const usable = audioStreams
          .filter((s) => typeof s.url === 'string' && s.url)
          .sort((a, b) => Number(String(b.mimeType).startsWith('audio/mp4')) - Number(String(a.mimeType).startsWith('audio/mp4')) || Number(b.bitrate || 0) - Number(a.bitrate || 0));
        if (usable.length === 0) {
          throw new Error('no audio streams');
        }
        const best = usable[0];
        return {
          videoId,
          url: String(best.url),
          mimeType: String(best.mimeType || 'audio/mp4').split(';')[0],
          bitrate: Number(best.bitrate || 0),
          contentLength: Number(best.contentLength || 0),
          approxDurationMs: Number(data.duration || 0) * 1000 || undefined,
          clientUsed: `piped:${base}`,
          expiresInSeconds: 21540,
        };
      } catch (err: any) {
        lastError = err?.name === 'AbortError' ? new Error('timeout') : (err as Error);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error(`Piped fallback failed: ${lastError?.message || 'unavailable'}`);
  }
}

export const youtubeMusicClient = new YoutubeMusicClient();
