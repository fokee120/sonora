import React, { useEffect, useRef, useState } from 'react';
import { cacheArtwork, highQualityArtwork, readArtwork } from '../../lib/artwork.js';
import type { Track } from '../../types/index.js';
export function Artwork({ track, className = '', alt }: { track: Pick<Track, 'id' | 'artworkUrl'>; className?: string; alt?: string }) {
  const fallback = track.artworkUrl || '/icon.svg';
  const [source, setSource] = useState(highQualityArtwork(fallback));
  const localSource = useRef<string | null>(null);
  const failures = useRef(new Set<string>());
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    let request = 0;
    localSource.current = null; failures.current.clear();
    setSource(navigator.onLine ? highQualityArtwork(fallback) : fallback);
    const show = async () => {
      const current = ++request;
      const blob = await readArtwork(track.id);
      if (!active || !blob || current !== request) return;
      const next = URL.createObjectURL(blob);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = next; localSource.current = next; setSource(next);
    };
    void show().catch(() => {});
    if (navigator.onLine && track.artworkUrl) void cacheArtwork(track).catch(() => {});
    const updated = (event: Event) => { if ((event as CustomEvent).detail === track.id) void show(); };
    window.addEventListener('sonora:artwork-saved', updated);
    return () => { active = false; request++; if (objectUrl) URL.revokeObjectURL(objectUrl); window.removeEventListener('sonora:artwork-saved', updated); };
  }, [track.id, track.artworkUrl]);
  return <img className={className} src={source} alt={alt || ''} draggable={false} decoding="async" loading="lazy" onError={event => {
    // A delayed remote-image error must never replace a cover already read from
    // local storage. Stop after the original URL and icon instead of retrying forever.
    if (localSource.current) { setSource(localSource.current); return; }
    const failed = event.currentTarget.src;
    failures.current.add(failed);
    const original = new URL(fallback, location.href).href;
    const icon = new URL('/icon.svg', location.href).href;
    if (!failures.current.has(original) && failed !== original) setSource(fallback);
    else if (!failures.current.has(icon) && failed !== icon) setSource('/icon.svg');
  }}/>;
}
