import { useAppearance } from '../lib/appearance.js';
import React, {useEffect,useState} from 'react';
import {useCloudAccount} from '../lib/cloudAccount.js';
import { Settings, ArrowUpRight, Play, Heart, Download, Headphones } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { usePlayer } from '../hooks/usePlayer.js';
import { TrackRow } from '../components/common/TrackRow.js';
import { Artwork } from '../components/common/Artwork.js';
import { PlaylistCover } from '../components/common/PlaylistCover.js';
import { RecommendationsSection } from '../components/home/RecommendationsSection.js';
import type { Track } from '../types/index.js';

export const HomeView: React.FC = () => {
  const { recentHistory, displayTracks, displayPlaylists, favorites, navigate, isLoadingLibrary } = useApp();
  const { playTrack } = usePlayer();
  const account=useCloudAccount();
  const [picture,setPicture]=useState('');
  useEffect(()=>{if(!account.authenticated||!account.profile){setPicture('');return;}const controller=new AbortController();const refresh=()=>{fetch('/api/account/profile/'+encodeURIComponent(account.profile!.uid)+'?summary=avatar',{signal:controller.signal}).then(r=>r.ok?r.json():null).then(v=>{if(v)setPicture(v.picture||'');}).catch(()=>{});};refresh();window.addEventListener('sonora:profile-changed',refresh);return()=>{controller.abort();window.removeEventListener('sonora:profile-changed',refresh);};},[account.authenticated,account.profile?.uid]);
  const recent = recentHistory.map(item => displayTracks.find(track => track.id === item.trackId)).filter((track): track is Track => !!track).slice(0, 6);
  const featured = recent[0] || displayTracks[0];
  const hour = new Date().getHours();
  const noir = useAppearance().style === 'gotham';
  return <div id="home-view" className="page-stack">
    <header className="home-header page-heading"><div><p className="eyebrow">{noir ? 'SONORA / AFTER DARK' : 'SONORA / FOR YOU'}</p><h1>{noir ? 'Gotham Nights.' : hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.'}</h1></div>
      <div className="home-header-actions"><button className="player-icon settings-shortcut" title="Settings" aria-label="Settings" onClick={() => navigate({ type: 'settings' })}><Settings size={22} /></button>{account.authenticated&&<button className="home-profile-bubble" aria-label="Your profile" onClick={()=>navigate({type:'profile'})}>{picture?<img src={picture} alt=""/>:<span>{account.profile?.displayName?.slice(0,1)||'♪'}</span>}</button>}</div>
    </header>
    <section className={'listening-hero ' + (featured ? 'has-artwork' : '')} aria-label="Start listening">
      <div className="hero-copy"><span className="eyebrow">{noir ? (featured ? 'TONIGHT’S SELECTION' : 'THE NIGHT IS YOURS') : featured ? 'PICK UP WHERE YOU LEFT OFF' : 'A LITTLE MORE YOU'}</span>
        <h2>{noir ? 'After\nhours.' : featured ? 'Back to your\nfavorites.' : 'Your world.\nOn repeat.'}</h2>
        <p>{featured ? featured.title + ' · ' + featured.artist : 'The songs you love. The ones you haven’t found yet. All in one place.'}</p>
        <button className="primary-button" onClick={() => featured ? playTrack(featured, recent.length ? recent : displayTracks) : navigate({ type: 'search' })}>{featured ? <Play size={17} fill="currentColor" /> : <Headphones size={18} />}{noir ? (featured ? 'Drop the needle' : 'Find tonight’s sound') : featured ? 'Listen again' : 'Find your sound'}</button>
      </div>
      {featured ? <div className="hero-artwork"><Artwork track={featured} alt={featured.album || featured.title} /></div> : <div className="sonora-record" aria-hidden="true"><div className="record-label"><span>s</span></div></div>}
    </section>
    <div className="collection-shortcuts">
      <button onClick={() => navigate({ type: 'liked' })}><span className="shortcut-icon favorite-icon"><Heart size={21} fill="currentColor" /></span><span><strong>Liked songs</strong><small>{favorites.size ? favorites.size + ' favorites' : 'Keep what moves you'}</small></span><ArrowUpRight size={17} /></button>
      <button onClick={() => navigate({ type: 'downloads' })}><span className="shortcut-icon"><Download size={21} /></span><span><strong>Downloads</strong><small>Ready when you are</small></span><ArrowUpRight size={17} /></button>
    </div>
    {isLoadingLibrary && <div className="skeleton-rows" role="status" aria-label="Loading your library"><i /><i /><i /></div>}
    {recent.length > 0 && <section data-testid="recently-played" className="section-stack"><div className="section-heading"><div><p className="eyebrow">FAMILIAR FAVORITES</p><h2>Recently played</h2></div><button className="text-button" onClick={() => playTrack(recent[0], recent)}><Play size={14} fill="currentColor" />Play all</button></div>
      <div className="song-list">{recent.map((track, index) => <TrackRow key={track.id} track={track} index={index} tracksContext={recent} />)}</div>
    </section>}
    {displayPlaylists.length > 0 && <section className="section-stack"><div className="section-heading"><h2>Made yours</h2><button className="text-button" onClick={() => navigate({ type: 'library' })}>Your playlists <ArrowUpRight size={15} /></button></div><div className="playlist-shelf">{displayPlaylists.slice(0, 4).map(playlist => <button key={playlist.id} className="playlist-tile" onClick={() => navigate({ type: 'playlist', id: playlist.id })}><PlaylistCover playlist={playlist} tracks={displayTracks} /><strong>{playlist.title}</strong><small>{playlist.trackIds.length} songs</small></button>)}</div></section>}
    <RecommendationsSection />
  </div>;
};
