import { DriveMusicService } from '../../src/server/drive/DriveMusicService';

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
};

type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void };
};

const driveMusicService = new DriveMusicService();

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

    const result = await driveMusicService.scanDriveMusic(accessToken, folderId);
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(500).json({
      error: 'Failed to scan Google Drive audio files',
      details: err?.message || String(err),
    });
  }
}
