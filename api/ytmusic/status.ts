import { downloaderService } from '../../src/server/ytmusic/DownloaderService.js';

type ApiRequest = {
  method?: string;
};

type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => {
    json: (body: unknown) => void;
  };
};

function normalizeUrl(value: string | undefined): string | null {
  const trimmed = (value || '').trim();
  return trimmed || null;
}

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const config = downloaderService.getConfig();
  const downloaderUrl = normalizeUrl(config.url);
  const apiKey = config.apiKey;
  const audioFormat = config.audioFormat;

  return res.status(200).json({
    searchAvailable: true,
    downloader: {
      enabled: Boolean(downloaderUrl),
      configured: Boolean(downloaderUrl),
      hasApiKey: Boolean(apiKey),
      audioFormat,
      url: downloaderUrl,
    },
  });
}
