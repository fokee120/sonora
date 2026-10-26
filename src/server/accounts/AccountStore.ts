import fs from 'fs';
import path from 'path';

/**
 * File-backed Sonora account store for the persistent host.
 *
 * Same pattern as DriveSessionStore: a JSON file next to the
 * server process, so accounts, preferences, and import metadata
 * survive a server restart. This is NOT a multi-tenant auth
 * system — Sonora is a private personal app, and the record is
 * keyed by the Firebase uid the client already proved. It
 * deliberately never stores Google access/refresh tokens or
 * audio bytes; sign-in persistence itself comes from Firebase
 * Auth on the client.
 */
export interface StoredAccount {
  profile: any;
  preferences: any;
  importedPlaylists: any[];
  updatedAt: number;
}

export class AccountStore {
  private accounts: Record<string, StoredAccount> = {};
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(process.cwd(), '.sonora-accounts.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (parsed && typeof parsed === 'object') this.accounts = parsed;
      }
    } catch (err) {
      console.warn('[AccountStore] Failed reading persistent accounts:', err);
    }
  }

  private saveToDisk(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.accounts, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[AccountStore] Failed writing persistent accounts:', err);
    }
  }

  public sync(uid: string, profile: any, preferences: any): StoredAccount {
    const existing = this.accounts[uid];
    const record: StoredAccount = {
      profile: { ...(existing?.profile || {}), ...profile, uid, lastSeenAt: Date.now() },
      preferences: preferences || existing?.preferences || null,
      importedPlaylists: existing?.importedPlaylists || [],
      updatedAt: Date.now(),
    };
    this.accounts[uid] = record;
    this.saveToDisk();
    return record;
  }

  public get(uid: string): StoredAccount | null {
    return this.accounts[uid] || null;
  }

  public recordImport(uid: string, meta: any): void {
    const record = this.accounts[uid];
    if (!record) return;
    record.importedPlaylists = [...(record.importedPlaylists || []), meta];
    record.updatedAt = Date.now();
    this.saveToDisk();
  }
}

export const accountStore = new AccountStore();
