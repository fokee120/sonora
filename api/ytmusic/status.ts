import { audioBackendService } from '../../src/server/ytmusic/AudioBackendService.js';

type ApiRequest = {
  method?: string;
};

type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => {
    json: (body: unknown) => void;
  };
};

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(200).json({
    searchAvailable: true,
    audioBackend: audioBackendService.getStatus(),
  });
}
