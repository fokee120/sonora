import { useState, useEffect } from 'react';
import { PlayerState, QueueItem, Track, QueueSource } from '../types/index.js';
import { playerEngine } from '../lib/audio/PlayerEngine.js';

export function usePlayer({progress=true}:{progress?:boolean}={}) {
  const [state, setState] = useState<PlayerState>(playerEngine.getState());
  const [queue, setQueue] = useState<QueueItem[]>(playerEngine.getQueue());

  useEffect(() => {
    const unsubState = playerEngine.subscribe((newState) => setState(previous => !progress && (Object.keys(newState) as (keyof PlayerState)[]).every(key=>key==='currentTime'||key==='bufferedTime'||Object.is(previous[key],newState[key])) ? previous : newState));
    const unsubQueue = playerEngine.subscribeQueue((newQueue) => setQueue(newQueue));
    return () => {
      unsubState();
      unsubQueue();
    };
  }, [progress]);

  return {
    ...state,
    queue,
    currentQueueIndex: playerEngine.getQueueIndex(),
    playQueueItem: (queueId: string) => playerEngine.playQueueItem(queueId),
    playTrack: (track: Track, tracksQueue?: Track[]) => playerEngine.playTrack(track, tracksQueue),
    playPlaylist: (id:string, tracks:Track[], shuffle:boolean, startTrack?:Track,profileId?:string) => playerEngine.playPlaylist(id,tracks,shuffle,startTrack,profileId),
    setQueue: (tracks: Track[], activeTrack?: Track) => playerEngine.setQueue(tracks, activeTrack),
    play: () => playerEngine.play(),
    pause: () => playerEngine.pause(),
    togglePlay: () => playerEngine.togglePlay(),
    next: () => playerEngine.next(),
    previous: () => playerEngine.previous(),
    previousSong: () => playerEngine.previous(true),
    seek: (time: number) => playerEngine.seek(time),
    setVolume: (vol: number) => playerEngine.setVolume(vol),
    toggleMute: () => playerEngine.toggleMute(),
    setRepeatMode: (mode: any) => playerEngine.setRepeatMode(mode),
    cycleRepeatMode: () => playerEngine.cycleRepeatMode(),
    toggleShuffle: () => playerEngine.toggleShuffle(),
    playNext: (track: Track,source?:QueueSource) => playerEngine.playNext(track,source),
    addToQueue: (track: Track,source?:QueueSource) => playerEngine.addToQueue(track,source),
    removeFromQueue: (queueId: string) => playerEngine.removeFromQueue(queueId),
    clearQueue: () => playerEngine.clearQueue(),
  };
}
