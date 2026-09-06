import fs from 'fs';
import path from 'path';

export interface ServerDriveUser {
  uid?: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
}

export interface ServerDriveSession {
  accessToken: string;
  user: ServerDriveUser | null;
  connectedAt: number;
  lastUsedAt: number;
}

export class DriveSessionStore {
  private session: ServerDriveSession | null = null;
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(process.cwd(), '.drive-session.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.accessToken === 'string' && parsed.accessToken.trim().length > 0) {
          this.session = {
            accessToken: parsed.accessToken,
            user: parsed.user || null,
            connectedAt: parsed.connectedAt || Date.now(),
            lastUsedAt: parsed.lastUsedAt || Date.now(),
          };
          console.log(`[DriveSessionStore] Restored Google Drive server session for ${this.session.user?.email || 'authenticated user'}`);
        }
      }
    } catch (err) {
      console.warn('[DriveSessionStore] Failed reading persistent session from disk:', err);
    }
  }

  private saveToDisk(): void {
    try {
      if (this.session) {
        fs.writeFileSync(this.filePath, JSON.stringify(this.session, null, 2), 'utf-8');
      } else if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
    } catch (err) {
      console.warn('[DriveSessionStore] Failed writing persistent session to disk:', err);
    }
  }

  public saveSession(accessToken: string, user?: ServerDriveUser | null): ServerDriveSession {
    this.session = {
      accessToken,
      user: user || null,
      connectedAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    this.saveToDisk();
    console.log(`[DriveSessionStore] Saved server-side login for: ${user?.email || 'authenticated user'}`);
    return this.session;
  }

  public getSession(): ServerDriveSession | null {
    if (this.session) {
      this.session.lastUsedAt = Date.now();
    }
    return this.session;
  }

  public getAccessToken(): string | null {
    if (!this.session) return null;
    this.session.lastUsedAt = Date.now();
    return this.session.accessToken;
  }

  public getUser(): ServerDriveUser | null {
    return this.session?.user || null;
  }

  public isAuthenticated(): boolean {
    return Boolean(this.session?.accessToken);
  }

  public clearSession(): void {
    this.session = null;
    this.saveToDisk();
    console.log('[DriveSessionStore] Cleared server-side Google Drive login session.');
  }
}

export const driveSessionStore = new DriveSessionStore();
