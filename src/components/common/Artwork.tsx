import React, { useEffect, useState } from 'react';
import { cacheArtwork, highQualityArtwork, readArtwork } from '../../lib/artwork.js';
import type { Track } from '../../types/index.js';
export function Artwork({ track, className = '', alt }: { track: Pick<Track, 'id' | 'artworkUrl'>; className?: string; alt?: string }) {
  const fallback = track.artworkUrl || '/icon.svg';
  const [source, setSource] = useState(highQualityArtwork(fallback));
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    let request = 0;
    setSource(navigator.onLine ? highQualityArtwork(fallback) : fallback);
    const show = async () => {
      const current = ++request;
      const blob = await readArtwork(track.id);
      if (!active || !blob || current !== request) return;
      const next = URL.createObjectURL(blob);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = next;
      setSource(next);
    };
    void show().catch(() => {});
    if (navigator.onLine && track.artworkUrl) void cacheArtwork(track).catch(() => {});
    const updated = (event: Event) => { if ((event as CustomEvent).detail === track.id) void show(); };
    window.addEventListener('sonora:artwork-saved', updated);
    return () => { active = false; request++; if (objectUrl) URL.revokeObjectURL(objectUrl); window.removeEventListener('sonora:artwork-saved', updated); };
  }, [track.id, track.artworkUrl]);
  return <img className={className} src={source} alt={alt || ''} draggable={false} decoding="async" loading="lazy" onError={event => {
    const next = event.currentTarget.src === new URL(fallback, location.href).href ? '/icon.svg' : fallback;
    if (event.currentTarget.src !== new URL(next, location.href).href) setSource(next);
  }} />;
}
