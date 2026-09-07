type ApiRequest = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => {
    json: (body: unknown) => void;
  };
};

type YtmSearchFilter = 'songs' | 'videos' | 'albums' | 'artists';

type JsonLike = {
  [key: string]: any;
};

const INNERTUBE_HOST = 'https://music.youtube.com';
const INNERTUBE_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';

const SEARCH_FILTER_PARAMS: Record<YtmSearchFilter, string> = {
  songs: 'EgWKAQIIAWoKEAkQBRAKEAMQBA==',
  videos: 'EgWKAQIQAWoKEAkQChAFEAMQBA==',
  albums: 'EgWKAQIYAWoKEAkQChAFEAMQBA==',
  artists: 'EgWKAQIgAWoKEAkQChAFEAMQBA==',
};

const TITLE_NOISE = [
  /\s*[\(\[](official\s+)?(music\s+)?video[\)\]]/gi,
  /\s*[\(\[]official\s+audio[\)\]]/gi,
  /\s*[\(\[](official\s+)?(lyric[s]?\s+)?video[\)\]]/gi,
  /\s*[\(\[]lyrics?[\)\]]/gi,
  /\s*[\(\[]audio[\)\]]/gi,
  /\s*[\(\[]visualizer[\)\]]/gi,
  /\s*[\(\[](hd|hq|4k)[\)\]]/gi,
];

function getQueryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function cleanSongTitle(raw: string): string {
  let title = raw;
  for (const pattern of TITLE_NOISE) {
    title = title.replace(pattern, '');
  }
  return title.trim() || raw.trim();
}

function firstRunText(node: JsonLike | undefined | null): string {
  const runs = node?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  if (Array.isArray(runs) && runs.length > 0) {
    return String(runs[0].text ?? '').trim();
  }
  return '';
}

function allRunTexts(node: JsonLike | undefined | null): string[] {
  const runs = node?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  if (!Array.isArray(runs)) return [];
  return runs.map((run: JsonLike) => String(run?.text ?? '')).filter(Boolean);
}

function parseDurationToSeconds(text: string): number {
  if (!text) return 0;
  const parts = text.split(':').map((part) => parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

function bestThumbnail(node: JsonLike | undefined | null): string | undefined {
  const thumbnails =
    node?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
    node?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;

  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return undefined;
  return [...thumbnails].sort(
    (a: JsonLike, b: JsonLike) => Number(b.width || 0) - Number(a.width || 0)
  )[0]?.url;
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

function parseSongRenderer(renderer: JsonLike, shelfTitle: string) {
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
    durationText = secondColTexts.find((text) => /^\d+(:\d{2})+$/.test(text));
  } else {
    const tokens: string[] = [];
    let current = '';

    for (const text of secondColTexts) {
      if (text === ' • ') {
        tokens.push(current.trim());
        current = '';
      } else {
        current += text;
      }
    }

    if (current.trim()) tokens.push(current.trim());

    const durationIndex = tokens.findIndex((text) => /^\d+(:\d{2})+$/.test(text));
    if (durationIndex >= 0) {
      durationText = tokens[durationIndex];
      tokens.splice(durationIndex, 1);
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
    thumbnailUrl: bestThumbnail(renderer) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    isVideo: isVideoShelf,
  };
}

async function searchYoutubeMusic(query: string, filter: YtmSearchFilter) {
  const body: JsonLike = {
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: '1.20240401.01.00',
        hl: 'en',
        gl: 'US',
      },
    },
    query,
    params: SEARCH_FILTER_PARAMS[filter],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(
      `${INNERTUBE_HOST}/youtubei/v1/search?key=${INNERTUBE_KEY}&prettyPrint=false`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          Origin: INNERTUBE_HOST,
          Referer: `${INNERTUBE_HOST}/`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error(`YouTube Music returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as JsonLike;
    const songs: ReturnType<typeof parseSongRenderer>[] = [];
    const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs ?? [];

    for (const tab of tabs) {
      const sections = tab?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
      for (const section of sections) {
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
          if (song) songs.push(song);
        }
      }
    }

    const seen = new Set<string>();
    const uniqueSongs = songs.filter((song) => {
      if (!song || seen.has(song.videoId)) return false;
      seen.add(song.videoId);
      return true;
    });

    return { query, filter, songs: uniqueSongs };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const query = getQueryValue(req.query?.q).trim();
  const rawFilter = getQueryValue(req.query?.filter).trim();
  const filter = (['songs', 'videos', 'albums', 'artists'].includes(rawFilter)
    ? rawFilter
    : 'songs') as YtmSearchFilter;

  if (!query) {
    return res.status(400).json({ error: 'Query parameter q is required' });
  }

  try {
    const result = await searchYoutubeMusic(query, filter);
    return res.status(200).json(result);
  } catch (err: any) {
    const message =
      err?.name === 'AbortError'
        ? 'YouTube Music search timed out'
        : err?.message || 'YouTube Music search failed';

    return res.status(502).json({
      error: 'YouTube Music search failed',
      details: message,
    });
  }
}
