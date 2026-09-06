import { IAudioStorage } from './IAudioStorage.js';
import { dbService } from '../db.js';

export class IndexedDBAudioStorage implements IAudioStorage {
  public name = 'IndexedDB Blob Storage (Optimized for Safari / iOS PWA)';
  private activeUrls = new Map<string, string>(); // trackId -> objectUrl

  public async save(trackId: string, blob: Blob, mimeType = 'audio/mpeg'): Promise<void> {
    await dbService.saveAudioBlob(trackId, blob, mimeType);
  }

  public async get(trackId: string): Promise<Blob | null> {
    return await dbService.getAudioBlob(trackId);
  }

  public async getPlaybackUrl(trackId: string): Promise<string | null> {
    // If URL already exists for this track, reuse it
    if (this.activeUrls.has(trackId)) {
      return this.activeUrls.get(trackId)!;
    }

    const blob = await this.get(trackId);
    if (!blob) return null;

    const url = URL.createObjectURL(blob);
    this.activeUrls.set(trackId, url);
    return url;
  }

  public revokePlaybackUrl(url: string): void {
    for (const [trackId, activeUrl] of this.activeUrls.entries()) {
      if (activeUrl === url) {
        URL.revokeObjectURL(activeUrl);
        this.activeUrls.delete(trackId);
        break;
      }
    }
  }

  public async delete(trackId: string): Promise<void> {
    if (this.activeUrls.has(trackId)) {
      URL.revokeObjectURL(this.activeUrls.get(trackId)!);
      this.activeUrls.delete(trackId);
    }
    await dbService.removeAudioBlob(trackId);
  }

  public async has(trackId: string): Promise<boolean> {
    return await dbService.hasAudioBlob(trackId);
  }

  public async clear(): Promise<void> {
    for (const url of this.activeUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.activeUrls.clear();
    await dbService.clearAllDownloads();
  }
}
