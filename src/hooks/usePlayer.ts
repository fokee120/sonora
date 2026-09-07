import { useState, useEffect } from 'react';
import { PlayerState, QueueItem, Track } from '../types/index.js';
import { playerEngine } from '../lib/audio/PlayerEngine.js';

export function usePlayer() {
  const [state, setState] = useState<PlayerState>(playerEngine.getState());
  const [queue, setQueue] = useState<QueueItem[]>(playerEngine.getQueue());

  useEffect(() => {
    const unsubState = playerEngine.subscribe((newState) => setState(newState));
    const unsubQueue = playerEngine.subscribeQueue((newQueue) => setQueue(newQueue));
    return () => {
      unsubState();
      unsubQueue();
    };
  }, []);

  return {
    ...state,
    queue,
    playTrack: (track: Track, tracksQueue?: Track[]) => playerEngine.playTrack(track, tracksQueue),
    setQueue: (tracks: Track[], activeTrack?: Track) => playerEngine.setQueue(tracks, activeTrack),
    play: () => playerEngine.play(),
    pause: () => playerEngine.pause(),
    togglePlay: () => playerEngine.togglePlay(),
    next: () => playerEngine.next(),
    previous: () => playerEngine.previous(),
    seek: (time: number) => playerEngine.seek(time),
    setVolume: (vol: number) => playerEngine.setVolume(vol),
    toggleMute: () => playerEngine.toggleMute(),
    setRepeatMode: (mode: any) => playerEngine.setRepeatMode(mode),
    cycleRepeatMode: () => playerEngine.cycleRepeatMode(),
    toggleShuffle: () => playerEngine.toggleShuffle(),
    playNext: (track: Track) => playerEngine.playNext(track),
    addToQueue: (track: Track) => playerEngine.addToQueue(track),
    removeFromQueue: (queueId: string) => playerEngine.removeFromQueue(queueId),
    clearQueue: () => playerEngine.clearQueue(),
  };
}
