import React, { useEffect, useState } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { TrackRow } from '../components/common/TrackRow.js';
import { prepareYoutubeBridge } from '../lib/audio/audioSource.js';
export const SearchView: React.FC = () => {
  const { displayTracks, isOnline, ytResults, isSearchingYt, searchYoutubeMusic, clearYtResults } = useApp();
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (isOnline) void prepareYoutubeBridge(); }, [isOnline]);
  useEffect(() => {
    if (saved || !isOnline) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { if (!query.trim()) { clearYtResults(); return; } setError(''); void searchYoutubeMusic(query, 'songs', controller.signal).catch(reason => { if (!controller.signal.aborted) setError(reason.message || 'Search failed. Try again.'); }); }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, saved, isOnline, searchYoutubeMusic, clearYtResults]);
  const local = saved || !isOnline;
  const results = local ? displayTracks.filter(track => `${track.title} ${track.artist}`.toLowerCase().includes(query.trim().toLowerCase())) : ytResults;
  return <div id="search-view" className="space-y-5 pb-8"><h1 className="text-3xl font-bold">Search</h1>
    <div className="search-field"><Search size={21} /><input id="search-input" aria-label="Search songs" value={query} onChange={event => setQuery(event.target.value)} placeholder="Songs, artists, something you love…" autoComplete="off" />{query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={19} /></button>}</div>
    <div className="segmented-tabs"><button aria-pressed={!saved} onClick={() => setSaved(false)}>Discover</button><button aria-pressed={saved} onClick={() => setSaved(true)}>Saved songs</button></div>
    {!isOnline && <p className="text-sm text-amber-200">You’re offline. Search your saved songs here.</p>}
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    {isSearchingYt && !local && <p role="status" className="flex gap-2 text-sm text-zinc-400"><Loader2 size={18} className="animate-spin" />Searching…</p>}
    {results.map((track, index) => <TrackRow key={track.id} track={track} index={index} tracksContext={results} />)}
    {!results.length && <p className="empty-state">{query ? 'No songs found. Try another search.' : 'Search for your next favorite.'}</p>}
  </div>;
};
