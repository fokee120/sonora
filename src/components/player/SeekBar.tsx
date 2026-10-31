import React, { useRef, useState } from 'react';
import { usePlayer } from '../../hooks/usePlayer.js';
export const formatTime = (seconds: number) => {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};
export function SeekBar({ compact = false }: { compact?: boolean }) {
  const { currentTime, duration, seek } = usePlayer();
  const [scrub, setScrub] = useState<number | null>(null);
  const dragging = useRef(false);
  const value = scrub ?? Math.min(currentTime, duration || 0);
  return <div className={compact ? 'seek-bar seek-compact' : 'seek-bar'}>
    <input type="range" role="slider" aria-label="Seek" aria-valuetext={formatTime(value)}
      aria-valuenow={value} min={0} max={duration || 1} step={0.1} value={value} disabled={!duration}
      style={{ '--range-progress': `${duration ? value / duration * 100 : 0}%` } as React.CSSProperties}
      onPointerDown={event => { event.stopPropagation(); dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); setScrub(value); }}
      onChange={event => { const next = Number(event.target.value); if (dragging.current) setScrub(next); else seek(next); }}
      onPointerUp={event => { dragging.current = false; seek(Number(event.currentTarget.value)); setScrub(null); }}
      onPointerCancel={() => { dragging.current = false; setScrub(null); }} onBlur={() => { dragging.current = false; setScrub(null); }}
      onKeyDown={event => {
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? duration
          : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? value + 5
          : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? value - 5 : null;
        if (next !== null) { event.preventDefault(); setScrub(null); seek(Math.max(0, Math.min(duration, next))); }
      }} />
    {!compact && <div className="seek-times"><span>{formatTime(value)}</span><span>−{formatTime(duration - value)}</span></div>}
  </div>;
}
