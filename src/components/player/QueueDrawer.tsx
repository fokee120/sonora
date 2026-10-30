import React from 'react';
import { X, Trash2, Play, ListMusic } from 'lucide-react';
import { usePlayer } from '../../hooks/usePlayer.js';
import { Artwork } from '../common/Artwork.js';
import { Overlay } from '../common/Overlay.js';
import type { QueueItem } from '../../types/index.js';

export const QueueDrawer: React.FC<{isOpen:boolean;onClose:()=>void}> = ({isOpen,onClose}) => {
  const {queue,currentQueueIndex,currentTrack,playQueueItem,removeFromQueue,clearQueue}=usePlayer();
  const upcoming=queue.slice(currentQueueIndex+1);
  const sections=[{title:'Your queue',items:upcoming.filter(item=>item.manual),manual:true},
    {title:'Up next',items:upcoming.filter(item=>!item.manual),manual:false}];
  const row=(item:QueueItem,index:number)=><div key={item.queueId} className="queue-row" data-manual={!!item.manual}>
    <button className="queue-song" onClick={()=>void playQueueItem(item.queueId)} aria-label={'Play '+item.track.title}>
      <span className="queue-number">{index+1}</span><Artwork track={item.track}/>
      <span className="queue-copy"><strong>{item.track.title}</strong><small>{item.track.artist}</small></span>
      <Play size={15} className="queue-play-icon"/>
    </button>
    <button className="player-icon" onClick={()=>removeFromQueue(item.queueId)} aria-label={'Remove '+item.track.title+' from queue'} title="Remove from queue"><X size={18}/></button>
  </div>;
  return <Overlay isOpen={isOpen} onClose={onClose} label="Play Queue" variant="drawer">
    <div className="queue-content">
      <header className="queue-header"><div><ListMusic size={20}/><h2>Play Queue</h2><span>{upcoming.length}</span></div><button className="player-icon" aria-label="Close queue" onClick={onClose}><X size={21}/></button></header>
      {currentTrack&&<section className="queue-current"><span className="eyebrow">Now playing</span><div><Artwork track={currentTrack}/><span><strong>{currentTrack.title}</strong><small>{currentTrack.artist}</small></span></div></section>}
      <div className="queue-scroll">
        {!!upcoming.length&&<div className="queue-tools"><p>Your picks play first.</p><button className="text-button" title="Clear upcoming queue" onClick={clearQueue}><Trash2 size={14}/>Clear upcoming</button></div>}
        {sections.map(section=>!!section.items.length&&<section className="queue-section" key={section.title} aria-label={section.title}><h3>{section.title}{section.manual&&<span>Added by you</span>}</h3>{section.items.map((item,index)=>row(item,section.manual?index:sections[0].items.length+index))}</section>)}
        {!upcoming.length&&<div className="queue-empty"><ListMusic size={30}/><h3>A little room for more.</h3><p>Swipe a song right or use its menu to add it here.</p></div>}
      </div>
    </div>
  </Overlay>;
};
