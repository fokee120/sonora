/**
 * Sonora accounts.
 *
 * The account identity is the Google identity from Firebase Auth
 * (see src/lib/googleAuth.ts). Firebase Auth persistence is
 * browser-local and survives server restarts and downtime: the
 * Firebase SDK refreshes its own tokens, and Sonora never stores a
 * Google access/refresh token in its account record.
 *
 * What lives in a Sonora account record:
 *  - profile: who signed in (uid, email, display name, photo)
 *  - preferences: explicit taste the user typed in (genres, artists, vibes)
 *  - imported playlists: metadata only (source, source id, title, counts)
 *
 * Preferences/profile are stored in IndexedDB on this device
 * (via dbService settings) and, best-effort, mirrored to the
 * persistent host's account store (POST /api/accounts/sync) so a
 * server restart does not lose them either. The mirror never
 * contains tokens or audio bytes.
 */

export interface SonoraAccountProfile {
  uid: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  provider: 'google';
  createdAt: number;
  lastSeenAt: number;
}

export type DiscoveryLevel = 'safe' | 'balanced' | 'adventurous';

export interface AccountPreferences {
  favouriteGenres: string[];
  favouriteArtists: string[];
  vibes: string[];
  discovery: DiscoveryLevel;
  instrumentalOnly: boolean;
  updatedAt: number;
}

export interface ServerAccountRecord {
  profile: SonoraAccountProfile;
  preferences: AccountPreferences;
  importedPlaylists: ImportedPlaylistMeta[];
  updatedAt: number;
}

export interface ImportedPlaylistMeta {
  source: 'spotify' | 'ytmusic' | 'youtube';
  sourceId: string;
  title: string;
  matched: number;
  unmatched: number;
  importedAt: number;
}

export function defaultPreferences(): AccountPreferences {
  return {
    favouriteGenres: [],
    favouriteArtists: [],
    vibes: [],
    discovery: 'balanced',
    instrumentalOnly: false,
    updatedAt: Date.now(),
  };
}

/** "jazz, soul, lo-fi" -> ["jazz", "soul", "lo-fi"] (deduped, order kept). */
export function parseCommaList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(',')) {
    const item = part.trim();
    if (item && !seen.has(item.toLowerCase())) {
      seen.add(item.toLowerCase());
      out.push(item);
    }
  }
  return out;
}

export function buildProfileFromFirebaseUser(
  user: { uid: string; email?: string | null; displayName?: string | null; photoURL?: string | null },
  existing?: SonoraAccountProfile | null
): SonoraAccountProfile {
  const now = Date.now();
  return {
    uid: user.uid,
    email: user.email || existing?.email,
    displayName: user.displayName || existing?.displayName,
    photoURL: user.photoURL || existing?.photoURL,
    provider: 'google',
    createdAt: existing?.createdAt || now,
    lastSeenAt: now,
  };
}

/**
 * Mirror a profile + preferences to the persistent host.
 * Best-effort: returns false (never throws) when the server is
 * down, which is exactly the downtime case this feature is for.
 */
export async function syncAccountToServer(
  profile: SonoraAccountProfile,
  preferences: AccountPreferences
): Promise<boolean> {
  try {
    const res = await fetch('/api/accounts/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, preferences }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchServerAccount(uid: string): Promise<ServerAccountRecord | null> {
  try {
    const res = await fetch(`/api/accounts/${encodeURIComponent(uid)}`);
    if (!res.ok) return null;
    return (await res.json()) as ServerAccountRecord;
  } catch {
    return null;
  }
}
