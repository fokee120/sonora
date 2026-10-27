import React, { useEffect, useRef, useState } from 'react';
import { dbService } from '../../lib/db.js';
import { dismissMissing, manuallyMatchMissing, syncPlaylist, type ImportJob } from '../../lib/importJobs.js';
import { cachedSearchYoutubeMusic } from '../../lib/ytmusic/youtubeMusic.js';
import type { ImportedTrack } from '../../lib/playlistImport.js';
import type { Track } from '../../types/index.js';

const entryKey = (entry: ImportedTrack) => `${entry.title}\u0000${entry.artist}`;
export function ImportProgressAuto({ playlistId }: { playlistId: string }) {
  const [job, setJob] = useState<ImportJob>();
  const [results, setResults] = useState<Record<string, Track[]>>({});
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pendingMatches, setPendingMatches] = useState<Set<string>>(() => new Set());
  const requested = useRef(new Set<string>());
  useEffect(() => { const refresh = () => void dbService.getSetting<ImportJob[]>('playlist_import_jobs', []).then(jobs => setJob(jobs.find(item => item.playlistId === playlistId))); refresh(); window.addEventListener('sonora:imports-changed', refresh); return () => window.removeEventListener('sonora:imports-changed', refresh); }, [playlistId]);
  const search = async (entry: ImportedTrack, query: string) => { try { const found = await cachedSearchYoutubeMusic(query, 'songs'); setResults(current => ({ ...current, [entryKey(entry)]: found.slice(0, 2) })); } catch (e) { setError(e instanceof Error ? e.message : 'Search failed'); } };
  useEffect(() => { let cancelled = false; const pending = (job?.missingEntries || []).filter(entry => !requested.current.has(entryKey(entry))); pending.forEach(entry => requested.current.add(entryKey(entry))); void (async () => { for (const entry of pending) { if (cancelled) break; await search(entry, `${entry.title} ${entry.artist}`); } })(); return () => { cancelled = true; pending.forEach(entry => { if (!results[entryKey(entry)]) requested.current.delete(entryKey(entry)); }); }; }, [job?.missingEntries]);
  const chooseMatch = (entry: ImportedTrack, track: Track) => {
    const key = entryKey(entry);
    setPendingMatches(current => new Set(current).add(key));
    setError('');
    void manuallyMatchMissing(playlistId, entry, track).then(() => {
      setJob(current => current ? { ...current, missingEntries: (current.missingEntries || []).filter(item => entryKey(item) !== key) } : current);
      setPendingMatches(current => { const next = new Set(current); next.delete(key); return next; });
    }).catch((e: unknown) => {
      setPendingMatches(current => { const next = new Set(current); next.delete(key); return next; });
      setError(e instanceof Error ? e.message : 'Could not save the match. Try again.');
    });
  };
  const missing = job?.status === 'running' ? [] : (job?.missingEntries || []).filter(entry => !pendingMatches.has(entryKey(entry)));
  return <div className="space-y-2 text-sm text-zinc-400">
    {job && <p role="status">{job.status === 'running' ? `Syncing ${job.cursor} of ${job.playlist.tracks.length} songs…` : job.status === 'done' ? `Synced ${job.playlist.tracks.length} entries · ${missing.length} unmatched` : `Sync paused: ${job.error}`}</p>}
    <button className="action-button" disabled={job?.status === 'running'} onClick={() => void syncPlaylist(playlistId).catch(e => setError(e.message))}>Sync source playlist</button>
    {missing.length > 0 && <div className="space-y-3"><p className="font-semibold text-amber-300">Unmatched songs ({missing.length})</p>{missing.map((entry, index) => { const key = entryKey(entry); return <section key={`${key}-${index}`} className="rounded-xl border border-zinc-800 p-3 space-y-2"><div className="flex justify-between gap-2"><span className="text-zinc-100">{entry.title} · {entry.artist}</span><button className="text-zinc-400 underline" onClick={() => void dismissMissing(playlistId, entry).catch(e => setError(e.message))}>Dismiss</button></div>{results[key] === undefined ? <p>Finding matches…</p> : results[key].length === 0 ? <p>No matches found.</p> : results[key].map(track => <button key={track.id} className="block w-full rounded-lg bg-zinc-900 p-2 text-left text-emerald-300" onClick={() => chooseMatch(entry, track)}>Use {track.title} — {track.artist}</button>)}<form className="flex gap-2" onSubmit={e => { e.preventDefault(); void search(entry, queries[key] || `${entry.title} ${entry.artist}`); }}><input aria-label={`Search for ${entry.title}`} className="min-w-0 flex-1 rounded-lg bg-zinc-900 p-2 text-zinc-100" placeholder="Search manually" value={queries[key] ?? `${entry.title} ${entry.artist}`} onChange={e => setQueries(current => ({ ...current, [key]: e.target.value }))} /><button className="action-button" type="submit">Search</button></form></section>; })}</div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
