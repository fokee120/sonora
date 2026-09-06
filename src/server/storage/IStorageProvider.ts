import { Track, Album, Artist } from '../../types/index.js';

export interface StorageObject {
  key: string;
  size: number;
  lastModified?: Date;
  etag?: string;
  contentType?: string;
}

export interface StorageStatus {
  isConfigured: boolean;
  provider: string;
  bucketName: string | null;
  projectId?: string | null;
  clientEmail?: string | null;
  hasPrivateKey?: boolean;
  connected?: boolean;
  error?: string | null;
}

export interface IStorageProvider {
  name: string;
  isConfigured(): boolean;
  getStatus(): Promise<StorageStatus>;
  testConnection(): Promise<{ connected: boolean; error?: string }>;
  listMusicFiles(prefix?: string): Promise<StorageObject[]>;
  getSignedStreamUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getSignedArtworkUrl(key: string, expiresInSeconds?: number): Promise<string>;
}
