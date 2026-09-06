export interface IAudioStorage {
  name: string;
  save(trackId: string, blob: Blob, mimeType?: string): Promise<void>;
  get(trackId: string): Promise<Blob | null>;
  getPlaybackUrl(trackId: string): Promise<string | null>;
  revokePlaybackUrl(url: string): void;
  delete(trackId: string): Promise<void>;
  has(trackId: string): Promise<boolean>;
  clear(): Promise<void>;
}
