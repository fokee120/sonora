import {test,expect,type Page} from '@playwright/test';
test.use({serviceWorkers:'block',viewport:{width:390,height:844}});
const tracks=['abcdefghijk','lmnopqrstuv','12345678901'].map((id,i)=>({id:'ytm:'+id,source:'ytmusic',sourceId:id,cloudKey:'ytmusic://'+id,title:['First song','New song','Another song'][i],artist:'Fixture',album:'Local mix',duration:4}));
function wav(){const size=64000,b=Buffer.alloc(size+44);b.write('RIFF');b.writeUInt32LE(size+36,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size,40);return b;}
async function openPlaylist(page:Page){await page.getByRole('button',{name:'Library',exact:true}).click();await page.locator('#library-view').getByText('Local mix',{exact:true}).click();await expect(page.locator('#playlist-detail-view')).toBeVisible();}
async function seed(page:Page,options:{downloaded?:boolean;keep?:boolean;imported?:boolean}={}){
 await page.evaluate(async({tracks,options,bytes})=>{const d='/src/lib/db.ts',{dbService}=await import(d);await dbService.saveTracks(tracks);await dbService.savePlaylist({id:'local-mix',title:'Local mix',description:'Keep my description',artworkUrl:undefined,trackIds:[tracks[0].id],keepDownloaded:options.keep,source:options.imported?{type:'file',id:'local-source'}:undefined,createdAt:1,updatedAt:1});
  if(options.downloaded){const blob=new Blob([new Uint8Array(bytes)],{type:'audio/wav'});await dbService.saveAudioBlob(tracks[0].id,blob,'audio/wav');await dbService.saveDownloadState({trackId:tracks[0].id,status:'completed',progress:100,bytesDownloaded:blob.size,totalBytes:blob.size});}
  if(options.imported){const entries=[{title:'Missing one',artist:'Source artist'},{title:'Missing two',artist:'Source artist'}];await dbService.setSetting('playlist_import_jobs',[{playlistId:'local-mix',playlist:{source:'file',sourceId:'local-source',title:'Local mix',tracks:entries},cursor:2,missing:2,missingEntries:entries,status:'done'}]);}
 },{tracks,options,bytes:[...wav()]});await page.reload();await page.evaluate(()=>(window as any).__prepareStorageFixture?.());await openPlaylist(page);
}
test.beforeEach(async({page,browserName},info)=>{
 await page.addInitScript(({ios,webkit})=>{
  // This Windows WebKit ephemeral profile rejects storing Blob objects.
  // Use real IndexedDB byte records to test playlist download orchestration;
  // native decoding and persisted audio are covered by the offline suites.
  if(webkit)(window as any).__prepareStorageFixture=async()=>{
   const path=new URL('/src/lib/db.ts',location.href).href,{dbService,getDB}=await import(path);
   dbService.saveAudioBlob=async(id,blob,mimeType='audio/mpeg')=>{await(await getDB()).put('audioBlobs',{trackId:id,bytes:await blob.arrayBuffer(),mimeType,size:blob.size,cachedAt:Date.now()} as any);};
   dbService.getAudioBlob=async id=>{const record=await(await getDB()).get('audioBlobs',id) as any;return record?.bytes?new Blob([record.bytes],{type:record.mimeType}):record?.blob||null;};
  };
  if(ios)Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'});
  const audios:any[]=[];(window as any).__localAudios=audios;
  class AudioFixture extends EventTarget{
   private _src='';currentTime=0;duration=4;volume=1;playbackRate=1;paused=true;error:any=null;preload='';buffered={length:0,end:()=>0};onloadedmetadata:any=null;onerror:any=null;
   constructor(){super();audios.push(this);}get src(){return this._src;}set src(value:string){this._src=value;queueMicrotask(()=>{this.onloadedmetadata?.();this.dispatchEvent(new Event('loadedmetadata'));});}
   play(){this.paused=false;queueMicrotask(()=>this.dispatchEvent(new Event('playing')));return Promise.resolve();}pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}removeAttribute(){this._src='';}load(){}
  }(window as any).Audio=AudioFixture;
 },{ios:info.title.includes('iOS'),webkit:browserName==='webkit'});
 await page.route('**/api/**',r=>r.fulfill({json:{tracks:[],songs:[],artists:[],albums:[]}}));
 await page.route('**/api/ytmusic/download/**',r=>r.fulfill({body:wav(),contentType:'audio/wav'}));
 await page.route('**/api/ytmusic/search?**',r=>{const second=new URL(r.request().url()).searchParams.get('q')?.includes('Missing two');return r.fulfill({json:{songs:[{videoId:second?'99887766554':'55443322110',title:second?'Top result two':'Top result one',artist:'Estimated artist',durationSeconds:4,thumbnailUrl:'/icon.svg'}]}});});
 await page.goto('/');await page.evaluate(()=>(window as any).__prepareStorageFixture?.());await page.evaluate(async()=>{const c='/src/lib/offline/AudioCache.ts';await(await import(c)).audioCache.setLimit(0);});
});
test('playlist download bar includes partial progress and follows all theme accents',async({page})=>{
 await seed(page);await page.evaluate(async tracks=>{const d='/src/lib/db.ts',o='/src/lib/offline/OfflineManager.ts';await(await import(d)).dbService.mutatePlaylist('local-mix',p=>({...p,trackIds:tracks.map(t=>t.id)}));const manager=(await import(o)).offlineManager;for(const [i,status,progress]of [[0,'completed',100],[1,'downloading',40],[2,'queued',0]]as const)(manager as any).downloadsCache.set(tracks[i].id,{trackId:tracks[i].id,status,progress});(manager as any).notify();const a='/src/lib/appearance.ts';(await import(a)).chooseTheme('forest');window.dispatchEvent(new Event('sonora:imports-changed'));},tracks);
 const meter=page.getByRole('progressbar',{name:'Playlist download progress'});await expect(meter).toHaveAttribute('aria-valuenow','46.67');
 for(const theme of ['forest','notebook','retro']){await page.evaluate(async theme=>{const a='/src/lib/appearance.ts';(await import(a)).chooseTheme(theme);await document.fonts.ready;},theme);const color=await meter.locator('span').evaluate(e=>getComputedStyle(e).backgroundColor);expect(color).not.toBe('rgba(0, 0, 0, 0)');await expect(meter).toHaveCSS('height','3px');await page.screenshot({path:'.sonora/qa/local-playlists/'+theme+'-progress-'+test.info().project.name+'.png'});}
 await expect(page.locator('.playlist-offline-status')).not.toContainText('%');
});
test('clicking the playlist cover chooses a photo directly and preserves the editor',async({page})=>{
 await seed(page);const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=100;c.height=80;const x=c.getContext('2d')!;x.fillStyle='#536e89';x.fillRect(0,0,100,80);return c.toDataURL().split(',')[1];});
 const chooserPromise=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Change playlist cover',exact:true}).click();await(await chooserPromise).setFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await expect.poll(()=>page.evaluate(async()=>{const d='/src/lib/db.ts';return(await(await import(d)).dbService.getPlaylist('local-mix'))?.artworkUrl;})).toMatch(/^data:image\/jpeg/);await expect(page.getByRole('dialog',{name:'Edit playlist'})).toHaveCount(0);
 await page.reload();await openPlaylist(page);await expect(page.locator('.playlist-hero-cover>img')).toHaveAttribute('src',/^data:image\/jpeg/);await page.getByRole('button',{name:'Edit playlist',exact:true}).click();await expect(page.getByLabel('Playlist title',{exact:true})).toHaveValue('Local mix');await expect(page.getByLabel('Playlist description',{exact:true})).toHaveValue('Keep my description');
});
test('estimate button adds top results directly without review',async({page})=>{
 await seed(page,{imported:true});await page.getByRole('button',{name:'Estimate matches',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>{const d='/src/lib/db.ts';return(await(await import(d)).dbService.getPlaylist('local-mix'))?.trackIds.length;})).toBe(3);
 await expect(page.getByRole('heading',{name:/Unmatched songs/})).toHaveCount(0);await expect(page.locator('.estimated-matches')).toHaveCount(0);
 expect(await page.evaluate(async()=>{const d='/src/lib/db.ts';return(await(await import(d)).dbService.getPlaylist('local-mix'))?.estimatedMatches?.length||0;})).toBe(0);
});
test('previous estimates become final playlist additions without a review step',async({page})=>{
 await seed(page,{imported:true});await page.evaluate(async track=>{const d='/src/lib/db.ts';await(await import(d)).dbService.mutatePlaylist('local-mix',p=>({...p,estimatedMatches:[{title:'Missing one',artist:'Source artist',trackId:track.id,added:true}]}));window.dispatchEvent(new Event('sonora:imports-changed'));},tracks[1]);
 await expect.poll(()=>page.evaluate(async()=>{const d='/src/lib/db.ts';const p=await(await import(d)).dbService.getPlaylist('local-mix');return{ids:p?.trackIds,remaining:p?.estimatedMatches?.length};})).toEqual({ids:[tracks[0].id,tracks[1].id],remaining:0});await expect(page.locator('.estimated-matches')).toHaveCount(0);
});
test('manual matches remain exact selections and unmatched options include visual and audio previews',async({page})=>{
 await seed(page,{imported:true});const entry=page.getByRole('region',{name:'Match Missing one',exact:true});await expect(entry.locator('.match-preview>img')).toBeVisible();await entry.getByRole('button',{name:'Preview Top result one',exact:true}).click();await expect(entry.getByRole('button',{name:'Stop preview of Top result one',exact:true})).toBeVisible();await expect(page.getByTestId('dock-notices')).toContainText('Preview');
 await entry.getByRole('button',{name:'Use Top result one — Estimated artist',exact:true}).click();await expect(entry).toHaveCount(0);await expect.poll(()=>page.evaluate(async()=>{const d='/src/lib/db.ts';return(await(await import(d)).dbService.getPlaylist('local-mix'))?.trackIds;})).toContain('ytm:55443322110');expect(await page.evaluate(async()=>{const d='/src/lib/db.ts';return(await(await import(d)).dbService.getPlaylist('local-mix'))?.estimatedMatches?.length||0;})).toBe(0);
});
test('downloading a playlist enables automatic saving for later additions from the UI',async({page})=>{
 const downloads:string[]=[];await page.route('**/api/ytmusic/download/**',r=>{downloads.push(new URL(r.request().url()).pathname.split('/').at(-1)!);return r.fulfill({body:wav(),contentType:'audio/wav'});});await seed(page);await page.getByRole('button',{name:'Download playlist',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>{const o='/src/lib/offline/OfflineManager.ts';return(await import(o)).offlineManager.isTrackDownloaded('ytm:abcdefghijk');})).toBe(true);
 await page.getByRole('button',{name:'Add songs',exact:true}).first().click();await page.getByRole('button',{name:'Add New song',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>{const o='/src/lib/offline/OfflineManager.ts';return(await import(o)).offlineManager.isTrackDownloaded('ytm:lmnopqrstuv');})).toBe(true);expect(downloads.filter(id=>id==='lmnopqrstuv')).toHaveLength(1);expect(downloads.filter(id=>id==='abcdefghijk')).toHaveLength(1);
});
test('legacy downloaded playlists keep new import and matching additions offline after reload',async({page})=>{
 await seed(page,{downloaded:true,imported:true});await expect.poll(()=>page.evaluate(async()=>{const d='/src/lib/db.ts';return(await(await import(d)).dbService.getPlaylist('local-mix'))?.keepDownloaded;})).toBe(true);
 await page.getByRole('button',{name:'Use Top result one — Estimated artist',exact:true}).click();await expect.poll(()=>page.evaluate(async()=>{const o='/src/lib/offline/OfflineManager.ts';return(await import(o)).offlineManager.isTrackDownloaded('ytm:55443322110');})).toBe(true);
 await page.evaluate(async id=>{const d='/src/lib/db.ts';await(await import(d)).dbService.mutatePlaylist('local-mix',p=>({...p,trackIds:[...p.trackIds,id]}));},tracks[2].id);await expect.poll(()=>page.evaluate(async()=>{const o='/src/lib/offline/OfflineManager.ts';return(await import(o)).offlineManager.isTrackDownloaded('ytm:12345678901');})).toBe(true);
});
test('offline additions wait for a connection and removing the playlist download disables future auto saves',async({page,context})=>{
 await seed(page,{downloaded:true,keep:true});await context.setOffline(true);await page.evaluate(async id=>{const d='/src/lib/db.ts';await(await import(d)).dbService.mutatePlaylist('local-mix',p=>({...p,trackIds:[...p.trackIds,id]}));},tracks[1].id);
 expect(await page.evaluate(async()=>{const o='/src/lib/offline/OfflineManager.ts';return(await import(o)).offlineManager.getDownloadState('ytm:lmnopqrstuv');})).toBeUndefined();await context.setOffline(false);
 await expect.poll(()=>page.evaluate(async()=>{const o='/src/lib/offline/OfflineManager.ts';return(await import(o)).offlineManager.isTrackDownloaded('ytm:lmnopqrstuv');})).toBe(true);
 await page.evaluate(async()=>{const d='/src/lib/db.ts',o='/src/lib/offline/OfflineManager.ts',playlist=await(await import(d)).dbService.getPlaylist('local-mix');await(await import(o)).offlineManager.removePlaylistDownload(playlist);});
 await page.evaluate(async id=>{const d='/src/lib/db.ts';await(await import(d)).dbService.mutatePlaylist('local-mix',p=>({...p,trackIds:[...p.trackIds,id]}));},tracks[2].id);
 const result=await page.evaluate(async()=>{const d='/src/lib/db.ts',o='/src/lib/offline/OfflineManager.ts';await(await import(o)).offlineManager.playlistUpdates;return{keep:(await(await import(d)).dbService.getPlaylist('local-mix'))?.keepDownloaded,state:(await import(o)).offlineManager.getDownloadState('ytm:12345678901')};});expect(result).toEqual({keep:false,state:undefined});
});
test('iOS preview returns to the original position on the same player without changing queue or history',async({page})=>{
 const result=await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',d='/src/lib/db.ts',e=(await import(p)).playerEngine;await e.playTrack(tracks[0],tracks.slice(0,2));const audio=(e as any).audio;audio.currentTime=2;audio.dispatchEvent(new Event('timeupdate'));const queue=e.getQueue().map(q=>q.queueId);const history=await(await import(d)).dbService.getPlayHistory();await e.previewTrack({...tracks[2],duration:180});const previewDuration=e.getState().duration;audio.currentTime=31;audio.dispatchEvent(new Event('timeupdate'));await Promise.resolve();await Promise.resolve();return{previewDuration,same:audio===(e as any).audio,queue,after:e.getQueue().map(q=>q.queueId),id:e.getState().currentTrack?.id,time:e.getState().currentTime,preview:e.getState().isPreview,historyBefore:history.length,historyAfter:(await(await import(d)).dbService.getPlayHistory()).length};},tracks);
 expect(result.previewDuration).toBe(30);expect(result.same).toBe(true);expect(result.after).toEqual(result.queue);expect(result.id).toBe(tracks[0].id);expect(result.time).toBe(2);expect(result.preview).toBe(false);expect(result.historyAfter).toBe(result.historyBefore);
});
test('iOS stopping a preview restores an originally paused song without autoplay or a persisted preview track',async({page})=>{
 const result=await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',d='/src/lib/db.ts',e=(await import(p)).playerEngine;await e.playTrack(tracks[0],tracks.slice(0,2));(e as any).audio.currentTime=2;e.pause();await e.previewTrack(tracks[2]);await e.stopPreview();await(e as any).queuePersistence;return{state:e.getState(),saved:await(await import(d)).dbService.getSetting('player_track',null),history:await(await import(d)).dbService.getPlayHistory()};},tracks);
 expect(result.state.currentTrack.id).toBe(tracks[0].id);expect(result.state.isPlaying).toBe(false);expect(result.state.currentTime).toBe(2);expect(result.saved.id).toBe(tracks[0].id);expect(result.history.some(item=>item.trackId===tracks[2].id)).toBe(false);
});
test('iOS preview failure returns to the previous song and normal Next preserves manual queue priority',async({page})=>{
 const result=await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;await e.playTrack(tracks[0],tracks.slice(0,2));e.addToQueue(tracks[2]);await e.previewTrack({...tracks[1],id:'ytm:99887766554',sourceId:'99887766554'});const audio=(e as any).audio;audio.error={code:3};audio.dispatchEvent(new Event('error'));await Promise.resolve();await Promise.resolve();audio.error=null;await e.previewTrack(tracks[1]);e.next();await Promise.resolve();return{id:e.getState().currentTrack?.id,preview:e.getPreviewState(),queue:e.getQueue().map(q=>q.track.id)};},tracks);
 expect(result.id).toBe(tracks[2].id);expect(result.preview.status).toBe('idle');expect(result.queue).toEqual([tracks[0].id,tracks[2].id,tracks[1].id]);
});

test('matching options and previews fit narrow screens in every visual style',async({page})=>{
 await seed(page,{imported:true});await expect(page.getByRole('button',{name:'Preview Top result one',exact:true})).toBeVisible();
 for(const theme of ['forest','notebook','retro']){await page.evaluate(async theme=>{const a='/src/lib/appearance.ts';(await import(a)).chooseTheme(theme);await document.fonts.ready;},theme);for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});expect(await page.locator('#playlist-detail-view').evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);}await page.setViewportSize({width:390,height:844});await page.getByRole('heading',{name:/Unmatched songs/}).scrollIntoViewIfNeeded();await page.screenshot({path:'.sonora/qa/local-playlists/'+theme+'-matching-'+test.info().project.name+'.png'});}
});
test('iOS native preview end and Pause restore the original song without advancing the queue',async({page})=>{
 await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;await e.playTrack(tracks[0],tracks.slice(0,2));(e as any).audio.currentTime=2;(e as any).audio.dispatchEvent(new Event('timeupdate'));await e.previewTrack(tracks[2]);(e as any).audio.dispatchEvent(new Event('ended'));},tracks);
 await expect.poll(()=>page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;return{id:e.getState().currentTrack?.id,playing:e.getState().isPlaying,index:e.getQueueIndex()};})).toEqual({id:tracks[0].id,playing:true,index:0});
 await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;await e.previewTrack(tracks[2]);(e as any).audio.pause();},tracks);
 expect(await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;return{id:e.getState().currentTrack?.id,playing:e.getState().isPlaying,index:e.getQueueIndex()};})).toEqual({id:tracks[0].id,playing:false,index:0});
});
