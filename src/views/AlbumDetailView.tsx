import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Play, Shuffle, Download, CheckCircle2, Disc3, RefreshCw, WifiOff, Loader2, BookmarkCheck } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { usePlayer } from '../hooks/usePlayer.js';
import { TrackRow } from '../components/common/TrackRow.js';
import { Artwork } from '../components/common/Artwork.js';
import { SaveAlbumSheet } from '../components/playlist/SaveAlbumSheet.js';
import { notify } from '../components/common/ToastHost.js';
import { offlineManager } from '../lib/offline/OfflineManager.js';
import { getCatalogPage, resolveAlbum, pageAlbum, artistRoute, type CatalogPage } from '../lib/ytmusic/catalog.js';
import type { Album } from '../types/index.js';

export const AlbumDetailView: React.FC<{ albumId: string }> = ({ albumId }) => {
  const { route, displayAlbums, displayTracks, navigate, isOnline, downloadAlbum, removeAlbumDownload, isDownloaded } = useApp();
  const { playTrack } = usePlayer();
  const [saveOpen, setSaveOpen] = useState(false);
  const [page, setPage] = useState<CatalogPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [moreBusy, setMoreBusy] = useState(false);
  const [preparingDownload, setPreparingDownload] = useState(false);
  const fromLibrary = route.type === 'album' && !!route.fromLibrary;

  let hint = { title: '', artist: '' };
  if (albumId.startsWith('name:')) {
    try { hint = JSON.parse(decodeURIComponent(albumId.slice(5))); } catch {}
  }
  if (route.type === 'album') hint = { title: route.title || hint.title, artist: route.artist || hint.artist };
  const { title, artist } = hint;
  const stored = displayAlbums.find(item => item.id === albumId);
  const storedId = stored?.id;

  useEffect(() => {
    const controller = new AbortController();
    setPage(null);
    setError('');
    if (storedId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const id = albumId.startsWith('catalog:') ? albumId.slice(8) : await resolveAlbum(title, artist, controller.signal);
        const result = await getCatalogPage(id, controller.signal);
        if (!controller.signal.aborted) setPage(result);
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Couldn’t load this album.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [albumId, storedId, title, artist, isOnline, retry]);

  const catalog = useMemo(() => page ? pageAlbum(page) : null, [page]);
  const saved = stored || (catalog && displayAlbums.find(item => item.id === catalog.id));
  const fallback = useMemo(() => !saved && !catalog
    ? displayTracks.filter(track => track.album === title && track.artist === artist) : [],
  [saved, catalog, displayTracks, title, artist]);
  const album: Album = saved || catalog || {
    id: albumId, title, artist, tracks: fallback, trackCount: fallback.length,
    artworkUrl: fallback[0]?.artworkUrl,
    duration: fallback.reduce((total, track) => total + track.duration, 0),
  };
  const tracks = album.tracks || [];
  const available = isOnline ? tracks : tracks.filter(track => isDownloaded(track.id));
  const artistId = album.artistId || (route.type === 'album' ? route.artistId : undefined);
  const downloadStatus = offlineManager.getAlbumDownloadStatus(album);
  const downloading = downloadStatus === 'downloading';
  const downloaded = downloadStatus === 'downloaded' && (!!saved || !page?.continuation);
  const downloadLabel = downloading ? 'Cancel album downloads' : downloaded ? 'Remove album download' : 'Download album';

  const nextPage = async (current: CatalogPage) => {
    const next = await getCatalogPage(current.browseId, undefined, current.continuation);
    const songs = [...new Map([...current.songs, ...next.songs].map(song => [song.videoId, song])).values()];
    return { ...current, songs, continuation: next.continuation };
  };

  const loadAlbum = async () => {
    if (!saved && !catalog) throw new Error('Connect to load this album’s full track list.');
    if (saved || !page?.continuation) return album;
    let full = page;
    const seen = new Set<string>();
    while (full.continuation) {
      if (seen.has(full.continuation)) throw new Error('Couldn’t load the complete album. Try again.');
      seen.add(full.continuation);
      full = await nextPage(full);
    }
    setPage(full);
    return pageAlbum(full);
  };

  const back = () => navigate(fromLibrary ? { type: 'library' } : artistId
    ? { type: 'artist', id: 'catalog:' + artistId, name: album.artist } : { type: 'search' });

  const play = (shuffle = false) => {
    if (!available.length) return;
    const queue = [...available];
    if (shuffle) {
      for (let index = queue.length - 1; index > 0; index--) {
        const other = Math.floor(Math.random() * (index + 1));
        [queue[index], queue[other]] = [queue[other], queue[index]];
      }
    }
    void playTrack(queue[0], queue);
  };

  const updateDownload = async () => {
    try {
      if (downloading) {
        offlineManager.cancelAlbumDownloads(album);
        notify('Album downloads cancelled');
      } else if (downloaded) {
        await removeAlbumDownload(album);
        notify('Album download removed');
      } else {
        setPreparingDownload(true);
        await downloadAlbum(await loadAlbum());
        notify('Album added to downloads');
      }
    } catch {
      notify('Couldn’t update album downloads.', true);
    } finally {
      setPreparingDownload(false);
    }
  };

  return <div id="album-detail-view" className="page-stack">
    <button className="text-button self-start" onClick={back}>
      <ArrowLeft size={17} />{fromLibrary ? 'Back to Library' : artistId ? 'Back to artist' : 'Back to Search'}
    </button>
    <header className="album-profile">
      <div className="album-profile-art">{album.artworkUrl
        ? <Artwork track={{ id: 'album:' + album.id, artworkUrl: album.artworkUrl }} alt={album.title} />
        : <Disc3 size={52} />}</div>
      <div>
        <p className="eyebrow">ALBUM{album.year ? ' / ' + album.year : ''}</p>
        <h1>{album.title || 'Album'}</h1>
        {album.artist && <button className="album-artist-link" onClick={() => navigate(artistRoute({ artist: album.artist, artistId }))}>{album.artist} ↗</button>}
        <p className="collection-count">{tracks.length} songs{album.duration ? ' · ' + Math.round(album.duration / 60) + ' min' : ''}</p>
        <div className="album-actions">
          <button className="action-button" disabled={!saved && (!catalog || !tracks.length || loading)} onClick={() => setSaveOpen(true)}>
            {saved && <BookmarkCheck size={17} />}{saved ? 'In Library' : 'Save album'}
          </button>
          <button className="primary-button" disabled={!available.length} onClick={() => play()}><Play size={17} fill="currentColor" />Play</button>
          <button className="action-button" disabled={!available.length} onClick={() => play(true)}><Shuffle size={17} />Shuffle</button>
          <button className="player-icon outlined-icon" title={downloadLabel} aria-label={downloadLabel}
            disabled={!tracks.length || (preparingDownload && !downloading) || (!downloaded && !downloading && (!isOnline || (!saved && !catalog)))}
            onClick={() => void updateDownload()}>
            {downloading || preparingDownload ? <Loader2 className="animate-spin" size={19} />
              : downloaded ? <CheckCircle2 size={19} /> : <Download size={19} />}
          </button>
        </div>
      </div>
    </header>
    {!isOnline && <p className="inline-message"><WifiOff size={16} />{available.length
      ? 'Downloaded tracks are available offline.' : 'Download this album when you’re online to listen offline.'}</p>}
    {error && !saved && <div role="alert" className="error-card">
      <p>{error}</p><button className="action-button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={16} />Try again</button>
    </div>}
    {loading && !saved && <div role="status" aria-label="Loading album" className="skeleton-rows"><i /><i /><i /></div>}
    {!!tracks.length && <section className="section-stack">
      <h2>Tracks</h2>
      <div className="song-list">{tracks.map((track, index) => (
        <TrackRow key={track.id} track={track} index={index} tracksContext={available} showAlbum={false} />
      ))}</div>
    </section>}
    {!saved && page?.continuation && <button className="action-button self-start" disabled={moreBusy || !isOnline}
      onClick={async () => {
        setMoreBusy(true);
        try { setPage(await nextPage(page)); }
        catch { setError('Couldn’t load more songs. Try again.'); }
        finally { setMoreBusy(false); }
      }}>{moreBusy ? 'Loading…' : 'Load more songs'}</button>}
    {saveOpen && <SaveAlbumSheet album={album} saved={!!saved} loadAlbum={loadAlbum}
      onClose={() => setSaveOpen(false)} onRemoved={() => { if (fromLibrary) navigate({ type: 'library' }); }} />}
  </div>;
};
