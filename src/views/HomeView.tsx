import React from 'react';
import { Settings, Search, ListMusic } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { TrackRow } from '../components/common/TrackRow.js';
import { RecommendationsSection } from '../components/home/RecommendationsSection.js';
export const HomeView: React.FC = () => {
  const { recentHistory, displayTracks, navigate } = useApp();
  const recent = recentHistory.map(item => displayTracks.find(track => track.id === item.trackId)).filter(Boolean).slice(0, 6);
  return <div id="home-view" className="space-y-7 pb-8">
    <header className="home-header"><div><p className="text-xs tracking-[.2em] text-blue-300">SONORA</p><h1 className="mt-2 text-3xl font-bold">Listen again.</h1></div>
      <button className="player-icon" title="Settings" aria-label="Settings" onClick={() => navigate({ type: 'settings' })}><Settings size={23} /></button>
    </header>
    {recent.length ? <section data-testid="recently-played" className="space-y-3"><h2 className="text-lg font-semibold">Recently played</h2>
      <div className="song-list">{recent.map((track, index) => <TrackRow key={track.id} track={track} index={index} tracksContext={recent} />)}</div>
    </section> : <div className="empty-state"><Search size={30} /><h2>Find your next favorite</h2><p>Search for a song to start listening.</p><button className="action-button" onClick={() => navigate({ type: 'search' })}>Explore music</button></div>}
    <button className="playlist-library-row" onClick={() => navigate({ type: 'library' })}><ListMusic size={23} /><span>Your playlists</span><span className="ml-auto text-zinc-500">→</span></button>
    <RecommendationsSection />
  </div>;
};
