import React, { useEffect, useState } from 'react';
import { User, LogOut, CheckCircle2, Save } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { signInWithGoogleDrive, logoutGoogleDrive } from '../../lib/googleAuth.js';
import { dbService } from '../../lib/db.js';
import {
  defaultPreferences,
  parseCommaList,
  buildProfileFromFirebaseUser,
  syncAccountToServer,
  type AccountPreferences,
  type SonoraAccountProfile,
} from '../../lib/accounts.js';

/**
 * Sonora account: the Google identity is the account.
 *
 * Sign-in persistence comes from Firebase Auth (browser-local,
 * token refresh handled by the SDK), so closing Sonora, or the
 * server going down and restarting, does not sign the user out.
 * Preferences are saved in IndexedDB on this device and mirrored
 * to the persistent host (/api/accounts/sync). The mirror holds
 * profile + preferences only — never a Google token.
 */
export const AccountCard: React.FC = () => {
  const { driveUser, setDriveUser } = useApp();
  const [prefs, setPrefs] = useState<AccountPreferences>(defaultPreferences());
  const [genres, setGenres] = useState('');
  const [artists, setArtists] = useState('');
  const [vibes, setVibes] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void dbService.getSetting<AccountPreferences | null>('sonora:account:preferences', null).then((saved) => {
      if (cancelled || !saved) return;
      setPrefs(saved);
      setGenres(saved.favouriteGenres.join(', '));
      setArtists(saved.favouriteArtists.join(', '));
      setVibes(saved.vibes.join(', '));
    });
    return () => { cancelled = true; };
  }, []);

  const handleSignIn = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await signInWithGoogleDrive();
      if (res) setDriveUser(res.user);
    } catch (err: any) {
      setError(err?.message || 'Failed to sign in with Google');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (!window.confirm('Sign out of your Sonora account on this device?')) return;
    await logoutGoogleDrive();
    setDriveUser(null);
  };

  const handleSave = async () => {
    const next: AccountPreferences = {
      ...prefs,
      favouriteGenres: parseCommaList(genres),
      favouriteArtists: parseCommaList(artists),
      vibes: parseCommaList(vibes),
      updatedAt: Date.now(),
    };
    setPrefs(next);
    await dbService.setSetting('sonora:account:preferences', next);
    let profile: SonoraAccountProfile | null = null;
    if (driveUser) {
      const existing = await dbService.getSetting<SonoraAccountProfile | null>('sonora:account:profile', null);
      profile = buildProfileFromFirebaseUser(driveUser, existing);
      await dbService.setSetting('sonora:account:profile', profile);
    }
    const synced = profile ? await syncAccountToServer(profile, next) : false;
    setStatus(
      profile
        ? synced
          ? 'Saved, and mirrored to the server — it survives a server restart.'
          : 'Saved on this device. Server mirror was unreachable, so it will retry on the next save.'
        : 'Saved on this device. Sign in with Google to mirror it to the server.'
    );
  };

  return (
    <section className="p-6 rounded-3xl bg-zinc-900/50 border border-zinc-800/80 shadow-xl space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center">
          <User className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">Sonora Account</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Sign in with Google once. Firebase keeps you signed in across server restarts and downtime —
            Sonora itself never stores your Google token.
          </p>
        </div>
      </div>

      {driveUser ? (
        <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-zinc-950/60 border border-zinc-800">
          <div className="flex items-center gap-3">
            {driveUser.photoURL && <img src={driveUser.photoURL} alt="" className="w-10 h-10 rounded-full" />}
            <div>
              <p className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
                {driveUser.displayName || driveUser.email || 'Signed in'}
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              </p>
              {driveUser.email && <p className="text-[11px] text-zinc-400">{driveUser.email}</p>}
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-rose-500/10 text-zinc-400 hover:text-rose-300 text-xs font-medium border border-zinc-700 transition"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      ) : (
        <button
          onClick={handleSignIn}
          disabled={isLoading}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition disabled:opacity-40"
        >
          {isLoading ? 'Signing in…' : 'Sign in with Google'}
        </button>
      )}
      {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="space-y-1 block">
          <span className="text-[11px] font-semibold text-zinc-400">Favourite genres</span>
          <input value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="jazz, soul, lo-fi"
            className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-600" />
        </label>
        <label className="space-y-1 block">
          <span className="text-[11px] font-semibold text-zinc-400">Favourite artists</span>
          <input value={artists} onChange={(e) => setArtists(e.target.value)} placeholder="Nujabes, Khruangbin"
            className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-600" />
        </label>
        <label className="space-y-1 block">
          <span className="text-[11px] font-semibold text-zinc-400">Vibes</span>
          <input value={vibes} onChange={(e) => setVibes(e.target.value)} placeholder="starry night, classy, instrumental"
            className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-600" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <input type="checkbox" checked={prefs.instrumentalOnly} onChange={(e) => setPrefs({ ...prefs, instrumentalOnly: e.target.checked })} />
          Prefer instrumental
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-300">
          Discovery
          <select value={prefs.discovery} onChange={(e) => setPrefs({ ...prefs, discovery: e.target.value as AccountPreferences['discovery'] })}
            className="px-2 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100">
            <option value="safe">Safe</option>
            <option value="balanced">Balanced</option>
            <option value="adventurous">Adventurous</option>
          </select>
        </label>
        <button onClick={handleSave}
          className="ml-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition">
          <Save className="w-3.5 h-3.5" /> Save preferences
        </button>
      </div>
      {status && <p role="status" className="text-xs text-zinc-300">{status}</p>}
    </section>
  );
};
