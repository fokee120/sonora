import React, { useEffect, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { TrackRow } from '../common/TrackRow.js';
import { cachedSearchYoutubeMusic } from '../../lib/ytmusic/youtubeMusic.js';
import { playerEngine } from '../../lib/audio/PlayerEngine.js';
import { audioCache } from '../../lib/offline/AudioCache.js';
import type { Playlist, Track } from '../../types/index.js';
export function PlaylistSuggestions({ playlist }: {
    playlist: Playlist;
}) {
    const { tracks, addTracksToLibrary, addTrackToPlaylist, isOnline } = useApp();
    const [suggested, setSuggested] = useState<Track[]>([]);
    const [error, setError] = useState('');
    const key = playlist.trackIds.join('|');
    useEffect(() => { let active = true; const seeds = tracks.filter(t => playlist.trackIds.includes(t.id)); const artists = [...new Set<string>(seeds.map(t => t.artist))].slice(0, 3); const load = async () => { const found = new Map<string, Track>(); for (const t of tracks)
        if (!playlist.trackIds.includes(t.id) && artists.includes(t.artist))
            found.set(t.id, t); if (isOnline)
        for (const artist of artists) {
            try {
                for (const t of await cachedSearchYoutubeMusic(artist, 'songs'))
                    if (!playlist.trackIds.includes(t.id))
                        found.set(t.id, t);
            }
            catch {
                if (active)
                    setError('Some suggestions could not be loaded.');
            }
        } if (active)
        setSuggested([...found.values()].slice(0, 15)); }; void load(); return () => { active = false; }; }, [playlist.id, key, isOnline]);
    useEffect(() => { audioCache.enqueue(suggested, 1); playerEngine.setPlaylistRecommendations(playlist.id, playlist.trackIds, suggested); }, [suggested, key, playlist.id]);
    return <section className="space-y-3"><h2 className="text-lg font-semibold flex gap-2 items-center"><Sparkles size={18}/>Recommended next</h2><p className="text-xs text-zinc-400">Continues after this playlist when repeat is off. Tap + to keep a song in this playlist.</p>{error && <p className="text-sm text-zinc-400">{error}</p>}{suggested.length === 0 && <p className="text-sm text-zinc-500">Add songs to find recommendations for this playlist.</p>}{suggested.filter(t => !playlist.trackIds.includes(t.id)).map((track, index) => <div key={track.id} className="flex items-center gap-1"><div className="min-w-0 flex-1"><TrackRow track={track} index={index} tracksContext={suggested}/></div><button className="player-icon text-blue-300" aria-label={`Add ${track.title} to ${playlist.title}`} onClick={async () => { await addTracksToLibrary([track]); await addTrackToPlaylist(playlist.id, track.id); }}><Plus size={21}/></button></div>)}</section>;
}
