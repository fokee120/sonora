import { Storage, Bucket } from '@google-cloud/storage';
import { IStorageProvider, StorageObject, StorageStatus } from './IStorageProvider.js';

export class GCSStorageProvider implements IStorageProvider {
  public name = 'Google Cloud Storage';
  private storage: Storage | null = null;
  private bucket: Bucket | null = null;
  private bucketName: string;
  private projectId: string;
  private clientEmail: string;

  constructor() {
    this.bucketName = process.env.GCS_BUCKET_NAME || '';
    this.projectId = process.env.GCP_PROJECT_ID || '';
    this.clientEmail = process.env.GCP_CLIENT_EMAIL || '';
    this.initClient();
  }

  private initClient(): void {
    const privateKey = process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, '\n');

    // Check if explicit service account credentials are provided
    if (this.bucketName && this.clientEmail && privateKey) {
      try {
        this.storage = new Storage({
          projectId: this.projectId || undefined,
          credentials: {
            client_email: this.clientEmail,
            private_key: privateKey,
          },
        });
        this.bucket = this.storage.bucket(this.bucketName);
      } catch (err) {
        console.error('Failed to initialize Google Cloud Storage client with credentials:', err);
        this.storage = null;
        this.bucket = null;
      }
      return;
    }

    // Fallback: If running inside GCP environment or with GOOGLE_APPLICATION_CREDENTIALS
    if (this.bucketName && (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.K_SERVICE)) {
      try {
        this.storage = new Storage({
          projectId: this.projectId || undefined,
        });
        this.bucket = this.storage.bucket(this.bucketName);
      } catch (err) {
        console.warn('GCS default application credentials initialization notice:', err);
      }
    }
  }

  public isConfigured(): boolean {
    const hasPrivateKey = Boolean(process.env.GCP_PRIVATE_KEY);
    const hasClientEmail = Boolean(this.clientEmail);
    const hasBucket = Boolean(this.bucketName);

    return Boolean(
      this.bucket &&
      hasBucket &&
      ((hasClientEmail && hasPrivateKey) || Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS))
    );
  }

  public getBucketName(): string {
    return this.bucketName;
  }

  public async getStatus(): Promise<StorageStatus> {
    const isConf = this.isConfigured();
    let connected = false;
    let error: string | null = null;

    if (isConf) {
      try {
        const testRes = await this.testConnection();
        connected = testRes.connected;
        if (!connected) {
          error = testRes.error || 'Unable to connect to GCS bucket';
        }
      } catch (err: any) {
        connected = false;
        error = err.message || 'Connection test failed';
      }
    }

    return {
      isConfigured: isConf,
      provider: this.name,
      bucketName: this.bucketName || null,
      projectId: this.projectId || null,
      clientEmail: this.clientEmail || null,
      hasPrivateKey: Boolean(process.env.GCP_PRIVATE_KEY),
      connected,
      error,
    };
  }

  public async testConnection(): Promise<{ connected: boolean; error?: string }> {
    if (!this.bucket) {
      return { connected: false, error: 'GCS client or bucket not initialized' };
    }

    try {
      const [exists] = await this.bucket.exists();
      if (!exists) {
        return { connected: false, error: `Bucket gs://${this.bucketName} was not found` };
      }
      return { connected: true };
    } catch (err: any) {
      return { connected: false, error: err.message || 'GCS connection error' };
    }
  }

  private sanitizeKey(key: string): string {
    // Prevent directory traversal or malicious characters
    const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.includes('..')) {
      throw new Error('Invalid key: path traversal characters detected');
    }
    return normalized;
  }

  /**
   * Recursively lists all objects in the GCS bucket matching the prefix.
   */
  public async listMusicFiles(prefix = 'music/'): Promise<StorageObject[]> {
    if (!this.bucket || !this.isConfigured()) {
      return [];
    }

    const objects: StorageObject[] = [];

    try {
      // In @google-cloud/storage, getFiles with autoPaginate: true handles pagination automatically
      const [files] = await this.bucket.getFiles({
        prefix: prefix ? this.sanitizeKey(prefix) : '',
        autoPaginate: true,
      });

      for (const file of files) {
        // Skip directory markers
        if (file.name.endsWith('/')) {
          continue;
        }

        const size = file.metadata.size ? Number(file.metadata.size) : 0;
        const lastModified = file.metadata.updated ? new Date(file.metadata.updated) : undefined;
        const contentType = file.metadata.contentType || undefined;

        objects.push({
          key: file.name,
          size,
          lastModified,
          etag: file.metadata.etag,
          contentType,
        });
      }
    } catch (err: any) {
      console.error('Error listing objects from Google Cloud Storage bucket:', err);
      throw err;
    }

    return objects;
  }

  /**
   * Generates a short-lived V4 signed GET URL for direct browser audio streaming.
   * Signed URLs expire after approximately 30-60 minutes (default 45 mins / 2700s).
   * Bucket remains private and objects are never made public.
   */
  public async getSignedStreamUrl(key: string, expiresInSeconds = 2700): Promise<string> {
    if (!this.bucket || !this.isConfigured()) {
      throw new Error('Google Cloud Storage is not configured. Please set GCP environment variables.');
    }

    const cleanKey = this.sanitizeKey(key);
    const file = this.bucket.file(cleanKey);

    // GCS V4 signed URL with read action and expiration
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiresInSeconds * 1000,
    });

    return signedUrl;
  }

  /**
   * Generates a short-lived V4 signed GET URL for artwork images.
   */
  public async getSignedArtworkUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    if (!this.bucket || !this.isConfigured()) {
      throw new Error('Google Cloud Storage is not configured.');
    }

    const cleanKey = this.sanitizeKey(key);
    const file = this.bucket.file(cleanKey);

    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiresInSeconds * 1000,
    });

    return signedUrl;
  }

  /**
   * Helper to programmatically configure CORS on the GCS bucket if credentials have storage.admin
   */
  public async configureCors(): Promise<{ success: boolean; message: string }> {
    if (!this.bucket || !this.isConfigured()) {
      throw new Error('GCS is not configured');
    }

    try {
      await this.bucket.setCorsConfiguration([
        {
          origin: ['http://localhost:3000', 'https://*.vercel.app', '*'],
          method: ['GET', 'HEAD'],
          responseHeader: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Type'],
          maxAgeSeconds: 3600,
        },
      ]);
      return { success: true, message: 'CORS successfully configured on GCS bucket.' };
    } catch (err: any) {
      console.warn('Could not programmatically set GCS CORS (insufficient permissions):', err.message);
      return {
        success: false,
        message: `Could not apply CORS automatically: ${err.message}. Use gsutil / gcloud CLI instead.`,
      };
    }
  }
}
