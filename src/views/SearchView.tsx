import {ytmSongToTrack} from '../lib/ytmusic/youtubeMusic.js';
import {useCloudAccount} from '../lib/cloudAccount.js';
import {SocialProfile} from '../components/settings/SocialProfile.js';
import type { Track } from '../types/index.js';
import React, { useEffect, useState } from 'react';
import { Search, X, Loader2, ArrowUpRight, Clock3, WifiOff } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { TrackRow } from '../components/common/TrackRow.js';
import { ArtistCards, AlbumCards } from '../components/common/CatalogCards.js';
import { searchCatalog, artistRoute, type CatalogArtist, type CatalogAlbum } from '../lib/ytmusic/catalog.js';
import { Artwork } from '../components/common/Artwork.js';
import { prepareYoutubeBridge } from '../lib/audio/audioSource.js';
const moods = [{ label: 'Slow mornings', query: 'acoustic soul morning', color: 'sage', note: 'Ease into the day' }, { label: 'After hours', query: 'late night r&b', color: 'violet', note: 'A little less ordinary' }, { label: 'In the zone', query: 'instrumental jazz focus', color: 'sand', note: 'Find your flow' }, { label: 'Turn it up', query: 'indie dance favorites', color: 'clay', note: 'Follow the feeling' }];
export const SearchView: React.FC = () => {
  const { route, navigate, displayTracks, isOnline, ytResults, isSearchingYt, searchYoutubeMusic, clearYtResults } = useApp();
  const [query, setQuery] = useState('');
  const [youtube,setYoutube]=useState(false),[videos,setVideos]=useState<Track[]>([]),[videoLoading,setVideoLoading]=useState(false);
  const account=useCloudAccount();
  const [peopleMode,setPeopleMode]=useState(false),[people,setPeople]=useState<any[]>([]),[personId,setPersonId]=useState(''),[peopleLoading,setPeopleLoading]=useState(false),[peopleError,setPeopleError]=useState('');
  useEffect(()=>{if(!peopleMode||!account.authenticated||!query.trim()){setPeople([]);setPeopleLoading(false);setPeopleError('');return;}const controller=new AbortController();setPeopleLoading(true);setPeopleError('');const timer=setTimeout(()=>{fetch('/api/account/people?q='+encodeURIComponent(query.trim()),{signal:controller.signal}).then(r=>{if(!r.ok)throw Error('Couldn’t search profiles.');return r.json();}).then(setPeople).catch(e=>{if(!controller.signal.aborted)setPeopleError(e.message);}).finally(()=>{if(!controller.signal.aborted)setPeopleLoading(false);});},350);return()=>{clearTimeout(timer);controller.abort();};},[peopleMode,account.authenticated,query]);
  const [kind,setKind]=useState<'songs'|'artists'|'albums'>('songs');
  const [catalog,setCatalog]=useState<{artists:CatalogArtist[];albums:CatalogAlbum[]}>({artists:[],albums:[]});
  const [catalogLoading,setCatalogLoading]=useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('sonora:recent-searches') || '[]').filter((v: unknown) => typeof v === 'string').slice(0, 6); } catch { return []; } });
  useEffect(() => { if (route.type === 'search' && route.query) setQuery(route.query); }, [route]);
  useEffect(() => { if (isOnline && route.type === 'search') void prepareYoutubeBridge(); }, [isOnline, route.type]);
  useEffect(() => {
    if (youtube || peopleMode || saved || !isOnline || route.type !== 'search' || kind !== 'songs') return;
    const controller = new AbortController();
    const timer = setTimeout(() => { if (!query.trim()) { clearYtResults(); return; } setError(''); void searchYoutubeMusic(query, 'songs', controller.signal).catch(reason => { if (!controller.signal.aborted) setError(reason.message || 'Search failed. Try again.'); }); }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, saved, isOnline, searchYoutubeMusic, clearYtResults, retry, route.type, kind, peopleMode, youtube]);
  useEffect(() => { if (ytResults.length && query.trim() && !isSearchingYt) { setRecent(previous => { const next = [query.trim(), ...previous.filter(q => q !== query.trim())].slice(0, 6); localStorage.setItem('sonora:recent-searches', JSON.stringify(next)); return next; }); } }, [ytResults]);

  useEffect(()=>{
    if(youtube||peopleMode||saved||!isOnline||route.type!=='search'||kind==='songs')return;
    const controller=new AbortController();setCatalog({artists:[],albums:[]});setError('');
    if(!query.trim()){setCatalogLoading(false);return;}
    setCatalogLoading(true);
    const timer=setTimeout(()=>{void searchCatalog(query,kind,controller.signal).then(result=>{if(!controller.signal.aborted)setCatalog(result);}).catch(e=>{if(!controller.signal.aborted)setError(e.message||'Search failed. Try again.');}).finally(()=>{if(!controller.signal.aborted)setCatalogLoading(false);});},350);
    return()=>{clearTimeout(timer);controller.abort();};
  },[query,kind,saved,isOnline,retry,route.type,peopleMode,youtube]);
  useEffect(()=>{
    if(!youtube||peopleMode||saved||!isOnline||route.type!=='search')return;
    const controller=new AbortController();setVideos([]);setError('');setVideoLoading(!!query.trim());
    if(!query.trim())return;
    const timer=setTimeout(()=>{fetch('/api/youtube/search?q='+encodeURIComponent(query.trim()),{signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error||'YouTube search failed.');return data;}).then(data=>{if(!controller.signal.aborted)setVideos((data.songs||[]).map(ytmSongToTrack));}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setVideoLoading(false);});},350);
    return()=>{clearTimeout(timer);controller.abort();};
  },[youtube,peopleMode,saved,isOnline,route.type,query,retry]);
  const local = saved || !isOnline;
  const results = local ? displayTracks.filter(track => (track.title + ' ' + track.artist).toLowerCase().includes(query.trim().toLowerCase())) : youtube ? videos : kind==='songs' && query.trim() ? ytResults : [];
  const loading=!local&&(youtube?videoLoading:kind==='songs'?isSearchingYt:catalogLoading);
  const catalogCount=kind==='artists'?catalog.artists.length:catalog.albums.length;
  const count=local||youtube||kind==='songs'?results.length:catalogCount;
  const fromCollection=[...new Map<string,Track>(displayTracks.map(track=>[track.artist,track] as [string,Track])).values()].slice(0,8);
  return <div id="search-view" className="page-stack"><header className="page-heading"><div><p className="eyebrow">FOLLOW YOUR CURIOSITY</p><h1>Search</h1></div></header>
    <form className="search-field" onSubmit={e => { e.preventDefault(); (document.activeElement as HTMLElement)?.blur(); }}><Search size={21} /><input onPointerDown={event=>{if(document.activeElement!==event.currentTarget){event.preventDefault();event.currentTarget.focus({preventScroll:true});}}} id="search-input" aria-label={peopleMode?'Search people':'Search songs'} type="search" enterKeyHint="search" value={query} onChange={event => { setQuery(event.target.value); setError(''); if (!event.target.value.trim()) clearYtResults(); }} placeholder={peopleMode?'Search people by name…':'Songs, artists, something you love…'} autoComplete="off" autoCorrect="off" spellCheck={false} />{query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); setError(''); clearYtResults(); }}><X size={19} /></button>}</form>
    <div className="segmented-tabs search-source-tabs"><button aria-pressed={!saved&&!peopleMode&&!youtube} onClick={()=>{setYoutube(false);setSaved(false);setPeopleMode(false);}}>YT Music</button><button aria-pressed={youtube&&!saved&&!peopleMode} onClick={()=>{setYoutube(true);setSaved(false);setPeopleMode(false);setKind('songs');setError('');}}>YouTube</button><button aria-pressed={saved&&!peopleMode} onClick={()=>{setSaved(true);setYoutube(false);setPeopleMode(false);}}>Saved songs</button><button aria-pressed={peopleMode} onClick={()=>{setPeopleMode(true);setYoutube(false);setPersonId('');}}>People</button></div>
    {peopleMode ? <section className="section-stack">{!account.authenticated?<div className="empty-state"><h2>Find your people</h2><p>Sign in with Google in Settings to search profiles.</p><button className="action-button" onClick={()=>navigate({type:'settings'})}>Open settings</button></div>:personId?<><button className="text-button" onClick={()=>setPersonId('')}>← Search results</button><SocialProfile initialProfileId={personId}/></>:<>{peopleLoading&&<p role="status">Searching profiles…</p>}{peopleError&&<p role="alert">{peopleError}</p>}{!peopleLoading&&!peopleError&&!query.trim()&&<p>Search for someone by their profile name.</p>}{!peopleLoading&&!peopleError&&!!query.trim()&&!people.length&&<p>No profiles found.</p>}<div className="social-list">{people.map(p=><button className="social-person" key={p.id} onClick={()=>navigate({type:'profile',id:p.id})}>{p.picture?<img src={p.picture} alt=""/>:<span>♪</span>}<strong>{p.name}</strong></button>)}</div></>}</section> : <>
    {!local && !youtube && <div className="discovery-filters" role="group" aria-label="Search categories">{(["songs","artists","albums"] as const).map(value=><button key={value} aria-pressed={kind===value} onClick={()=>{setKind(value);setError("");}}>{value[0].toUpperCase()+value.slice(1)}</button>)}</div>}
    {!isOnline && <p className="inline-message"><WifiOff size={17} />You’re offline. Search your saved songs here.</p>}
    {error && <div role="alert" className="error-card"><strong>Couldn’t reach the music.</strong><p>{error}</p><button className="action-button" onClick={() => setRetry(n => n + 1)}>Try again</button></div>}
    {loading && <div className="search-loading" role="status"><span><Loader2 size={17} className="animate-spin" />Searching…</span><div className="skeleton-rows" aria-hidden="true"><i /><i /><i /><i /></div></div>}
    {results.length > 0 && !loading && <section className="section-stack"><div className="section-heading"><h2>{local ? 'In your library' : youtube ? 'YouTube · Audio only' : 'Songs'}</h2><span className="collection-count">{results.length} results</span></div><div className="song-list" aria-label="Search results">{results.map((track, index) => <TrackRow key={track.id} track={track} index={index} tracksContext={results} />)}</div></section>}
    {!local && !youtube && kind!=="songs" && !!query.trim() && !loading && catalogCount>0 && <section className="section-stack"><div className="section-heading"><h2>{kind==="artists"?"Artists":"Albums"}</h2><span className="collection-count">{catalogCount} results</span></div>{kind==="artists"?<ArtistCards artists={catalog.artists}/>:<AlbumCards albums={catalog.albums}/>}</section>}
    {!count && !loading && !error && (query.trim() || local ? <div className="empty-state"><Search size={28} /><h2>{query ? (kind==='songs'||local?'No songs found.':kind==='artists'?'No artists found.':'No albums found.') : 'Your music, a little closer.'}</h2><p>{query ? 'Try another song, artist, or a few different words.' : 'Search your saved songs by title or artist.'}</p></div> : <>
      {recent.length > 0 && <section className="section-stack"><div className="section-heading"><h2>Recent searches</h2><button className="text-button" onClick={() => { setRecent([]); localStorage.removeItem('sonora:recent-searches'); }}>Clear</button></div><div className="recent-searches">{recent.map(q => <button key={q} onClick={() => setQuery(q)}><Clock3 size={16} /><span>{q}</span><ArrowUpRight size={16} /></button>)}</div></section>}
      <section className="section-stack"><div className="section-heading"><div><h2>Find a feeling</h2><p>Search for your next favorite.</p></div></div><div className="mood-grid">{moods.map((m, i) => <button key={m.label} className={'mood-card mood-' + m.color} onClick={() => setQuery(m.query)}><span className="mood-number">0{i + 1}</span><ArrowUpRight size={19} /><strong>{m.label}</strong><small>{m.note}</small><span className="mood-lines" aria-hidden="true" /></button>)}</div></section>
      {fromCollection.length>0 && <section className="section-stack"><div className="section-heading"><h2>From your collection</h2></div><div className="collection-artists">{fromCollection.map(track=><button key={track.artist} onClick={()=>navigate(artistRoute(track))}><Artwork track={track}/><strong>{track.artist}</strong><small>Explore artist</small></button>)}</div></section>}
    </>)}
    </>}
  </div>;
};
