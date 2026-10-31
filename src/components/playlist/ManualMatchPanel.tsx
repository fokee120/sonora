import React, { useEffect, useState } from 'react';
import { dbService } from '../../lib/db.js';
import { cachedSearchYoutubeMusic } from '../../lib/ytmusic/youtubeMusic.js';
import { manuallyMatchMissing, type ImportJob } from '../../lib/importJobs.js';
import { useApp } from '../../context/AppContext.js';
export function ManualMatchPanel({ playlistId }: { playlistId: string }) {
  const [job, setJob] = useState<ImportJob>(); useEffect(() => { const refresh = () => void dbService.getSetting<ImportJob[]>('playlist_import_jobs', []).then(jobs => setJob(jobs.find(item => item.playlistId === playlistId))); refresh(); window.addEventListener('sonora:imports-changed', refresh); return () => window.removeEventListener('sonora:imports-changed', refresh); }, [playlistId]);
  const { navigate } = useApp(); const [results, setResults] = useState<Record<string, any[]>>({}); const [error, setError] = useState('');
  const search = async (entry: any) => { const key = `${entry.title}|${entry.artist}`; try { const found = await cachedSearchYoutubeMusic(`${entry.title} ${entry.artist}`, 'songs'); setResults(current => ({ ...current, [key]: found.slice(0, 5) })); } catch (e: any) { setError(e.message || 'Search failed'); } };
  if (!job?.missingEntries?.length) return null;
  return <div className="mt-3 space-y-2"><p className="font-semibold text-amber-300">Unmatched songs — choose a match:</p>{job.missingEntries.map(entry => { const key = `${entry.title}|${entry.artist}`; return <div key={key} className="rounded-xl border border-zinc-800 p-2"><div className="flex items-center justify-between gap-2"><span className="truncate text-zinc-200">{entry.title} · {entry.artist}</span><button className="action-button" onClick={() => void search(entry)}>Find match</button></div>{results[key]?.map((track: any) => <div key={track.id} className="mt-2 rounded-lg bg-zinc-900 p-2"><button className="w-full text-left text-emerald-300" onClick={() => void manuallyMatchMissing(playlistId, entry, track)}>{track.title} — {track.artist}</button><button className="mt-1 text-[11px] text-indigo-300 underline" onClick={() => navigate({ type: 'search', query: `${entry.title} ${entry.artist}` })}>Search manually</button></div>)}</div>; })}{error && <p role="alert">{error}</p>}</div>;
}
