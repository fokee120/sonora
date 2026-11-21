import {getConnectionState,subscribeConnection} from '../lib/serverConnection.js';
import {useRemotePlayback,remotePlaybackCommand} from '../lib/sharedPlayback.js';
import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { PlayerState, QueueItem, Track, QueueSource } from '../types/index.js';
import { playerEngine } from '../lib/audio/PlayerEngine.js';

export function usePlayer({progress=true, subscribeQueue=true}:{progress?:boolean;subscribeQueue?:boolean}={}) {
  const [state, setState] = useState<PlayerState>(playerEngine.getState());
  const [queue, setQueue] = useState<QueueItem[]>(playerEngine.getQueue());

  const lastState = useRef(state);
  useEffect(() => {
    const unsubState = playerEngine.subscribe(newState => {
      const previous = lastState.current;
      if ((Object.keys(newState) as (keyof PlayerState)[]).every(key =>
        (!progress && (key === 'currentTime' || key === 'bufferedTime')) || Object.is(previous[key], newState[key]))) return;
      lastState.current = newState;
      setState(newState);
    });
    const unsubQueue = subscribeQueue ? playerEngine.subscribeQueue(setQueue) : undefined;
    return () => {
      unsubState();
      unsubQueue?.();
    };
  }, [progress, subscribeQueue]);

  const network=useSyncExternalStore(subscribeConnection,getConnectionState);
  const snapshot = useRemotePlayback();
  const remote = network.isOnline && snapshot;
  const visible:PlayerState=remote?{...state,currentTrack:remote.track,isPlaying:remote.playing,isLoading:false,currentTime:remote.position,duration:remote.track?.duration||0,playlistId:remote.playlistId,shuffle:remote.shuffle??state.shuffle,repeatMode:remote.repeatMode||state.repeatMode}:state;
  const visibleQueue:QueueItem[]=remote?(remote.items||(remote.queue||[]).map((track:Track)=>({track,queueId:track.id}))):queue;
  return {
    ...visible,
    queue:visibleQueue,
    currentQueueIndex: remote?remote.queueIndex||0:playerEngine.getQueueIndex(),
    playQueueItem: (queueId: string) => {const track=visibleQueue.find(q=>q.queueId===queueId)?.track;if(track&&remotePlaybackCommand({action:'track',track,queue:visibleQueue.map(q=>q.track)}))return;playerEngine.playQueueItem(queueId);},
    playTrack: async (track: Track, tracksQueue?: Track[]) => {if(!remotePlaybackCommand({action:'track',track,queue:tracksQueue||[track]}))await playerEngine.playTrack(track, tracksQueue);},
    playPlaylist: async (id:string, tracks:Track[], shuffle:boolean, startTrack?:Track,profileId?:string) => {if(!remotePlaybackCommand({action:'playlist',id,tracks,shuffle,startTrack,profileId}))await playerEngine.playPlaylist(id,tracks,shuffle,startTrack,profileId);},
    setQueue: (tracks: Track[], activeTrack?: Track) => {if(!remotePlaybackCommand({action:'setQueue',tracks,activeTrack}))playerEngine.setQueue(tracks,activeTrack);},
    play: () => {if(!remotePlaybackCommand({action:'play'}))void playerEngine.play();},
    pause: () => {if(!remotePlaybackCommand({action:'pause'}))playerEngine.pause();},
    togglePlay: () => {if(!remotePlaybackCommand({action:visible.isPlaying?'pause':'play'}))playerEngine.togglePlay();},
    next: () => {if(!remotePlaybackCommand({action:'next'}))playerEngine.next();},
    previous: () => {if(!remotePlaybackCommand({action:'previous'}))playerEngine.previous();},
    previousSong: () => {if(!remotePlaybackCommand({action:'previous'}))playerEngine.previous(true);},
    seek: (time: number) => {if(!remotePlaybackCommand({action:'seek',position:time}))playerEngine.seek(time);},
    setVolume: (vol: number) => playerEngine.setVolume(vol),
    toggleMute: () => playerEngine.toggleMute(),
    setRepeatMode: (mode: any) => {if(!remotePlaybackCommand({action:'repeatMode',mode}))playerEngine.setRepeatMode(mode);},
    cycleRepeatMode: () => {if(!remotePlaybackCommand({action:'repeat'}))playerEngine.cycleRepeatMode();},
    toggleShuffle: () => {if(!remotePlaybackCommand({action:'shuffle'}))playerEngine.toggleShuffle();},
    playNext: (track: Track,source?:QueueSource) => {if(!remotePlaybackCommand({action:'queue',track,source,next:true}))playerEngine.playNext(track,source);},
    addToQueue: (track: Track,source?:QueueSource) => remotePlaybackCommand({action:'queue',track,source})||playerEngine.addToQueue(track,source),
    removeFromQueue: (queueId: string) => {if(!remotePlaybackCommand({action:'removeQueue',queueId}))playerEngine.removeFromQueue(queueId);},
    clearQueue: () => {if(!remotePlaybackCommand({action:'clearQueue'}))playerEngine.clearQueue();},
  };
}
