import React, { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { TrackRow } from '../common/TrackRow.js';
import { cachedSearchYoutubeMusic, searchYoutubeMusic } from '../../lib/ytmusic/youtubeMusic.js';
import { playerEngine } from '../../lib/audio/PlayerEngine.js';
import { audioCache } from '../../lib/offline/AudioCache.js';
import type { Playlist, Track } from '../../types/index.js';
export function PlaylistSuggestions({ playlist }: {
    playlist: Playlist;
}) {
    const { tracks, addTracksToLibrary, addTrackToPlaylist, isOnline } = useApp();
    const [suggested, setSuggested] = useState<Track[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const key = playlist.trackIds.join('|');
    const artistsKey = useMemo(() => { const ids = new Set(playlist.trackIds); return JSON.stringify([...new Set(tracks.filter(t => ids.has(t.id)).map(t => t.artist))].slice(0, 3)); }, [tracks, key]);
    useEffect(() => { let active = true; const artists: string[] = JSON.parse(artistsKey); const ids = new Set(playlist.trackIds); const load = async () => {
        setLoading(true); setError(''); const found = new Map<string, Track>();
        for (const track of tracks) if (!ids.has(track.id) && artists.includes(track.artist)) found.set(track.id, track);
        if (isOnline) for (const artist of artists) {
            try { for (const track of await (refresh ? searchYoutubeMusic(artist, 'songs') : cachedSearchYoutubeMusic(artist, 'songs'))) if (!ids.has(track.id)) found.set(track.id, track); }
            catch { if (active) setError('Some suggestions could not be loaded.'); }
        }
        if (active) { const items = [...found.values()]; const step = items.length > 15 ? 15 : 1; const shift = items.length ? (refresh * step) % items.length : 0; setSuggested([...items.slice(shift), ...items.slice(0, shift)].slice(0, 15)); setLoading(false); }
    }; void load(); return () => { active = false; }; }, [playlist.id, key, isOnline, artistsKey, refresh]);
    useEffect(() => { audioCache.enqueue(suggested, 1); playerEngine.setPlaylistRecommendations(playlist.id, playlist.trackIds, suggested); }, [suggested, key, playlist.id]);
    const visible = suggested.filter(track => !playlist.trackIds.includes(track.id));
    return <section className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold flex gap-2 items-center"><Sparkles size={18}/>Recommended next</h2><button className="player-icon text-blue-400" aria-label="Refresh playlist recommendations" title="Refresh playlist recommendations" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={18} className={loading ? 'animate-spin' : ''}/></button></div><p className="text-xs text-zinc-400">Continues after this playlist when repeat is off. Tap + to keep a song in this playlist.</p>{error && <p className="text-sm text-zinc-400">{error}</p>}{!loading && visible.length === 0 && <p className="text-sm text-zinc-500">Add songs to find recommendations for this playlist.</p>}{visible.length > 0 && <div className="song-list">{visible.map((track, index) => <TrackRow key={track.id} track={track} index={index} tracksContext={visible} trailingAction={<button className="player-icon text-blue-300" aria-label={`Add ${track.title} to ${playlist.title}`} onClick={async event => { event.stopPropagation(); await addTracksToLibrary([track]); await addTrackToPlaylist(playlist.id, track.id); }}><Plus size={21}/></button>}/>)}</div>}</section>;
}
