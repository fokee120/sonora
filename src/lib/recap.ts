import type { Track } from '../types/index.js';
export interface PlayEntry { id: string; track?: Track; trackId: string; playedAt: number; }
export function dayStart(time: number) { const date = new Date(time); date.setHours(0,0,0,0); return date; }
export function periodBounds(now: number, mode: 'daily'|'weekly', offset: number) {
  const start = dayStart(now);
  if (mode === 'weekly') start.setDate(start.getDate() - start.getDay());
  start.setDate(start.getDate() + offset * (mode === 'daily' ? 1 : 7));
  const end = new Date(start); end.setDate(end.getDate() + (mode === 'daily' ? 1 : 7));
  return {start: start.getTime(), end: end.getTime()};
}
export function dayLabel(time: number, now = Date.now()) {
  const date = dayStart(time), recent = dayStart(now); recent.setDate(recent.getDate()-6);
  return time >= recent.getTime() ? date.toLocaleDateString('en-US',{weekday:'long'}) : numericDate(time);
}
export function numericDate(time: number) { const d=new Date(time); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; }
export function rankPlays(entries: PlayEntry[], tracks: Track[], kind: 'song'|'artist'|'genre') {
  const byId=new Map(tracks.map(t=>[t.id,t]));
  const groups=new Map<string,{name:string;count:number;track?:Track;unique:Set<string>}>();
  for(const entry of entries){
    const track=byId.get(entry.trackId) || entry.track;
    if(!track) continue;
    const name=kind==='song'?track.title:kind==='artist'?track.artist:track.genre;
    if(!name?.trim()) continue;
    const key=kind==='song'?track.id:name.trim().toLocaleLowerCase();
    const group=groups.get(key)||{name:name.trim(),count:0,track,unique:new Set<string>()};
    group.count++;group.unique.add(track.id);groups.set(key,group);
  }
  return [...groups.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)).slice(0,3);
}
export interface WeeklySnapshot {start:number;release:number;end:number;entries:PlayEntry[];}
/** Saturday releases close at midnight; later listening cannot alter the released edition. */
export function snapshotWeeks(entries:PlayEntry[],now:number,existing:WeeklySnapshot[]=[],offset=-new Date(now).getTimezoneOffset()):WeeklySnapshot[]{
 const shift=offset*60000,day=86400000,date=new Date(now+shift);date.setUTCHours(0,0,0,0);const latest=date.getTime()-shift-((date.getUTCDay()+1)%7)*day;
 const saved=new Map(existing.map(s=>[s.release,s]));const buckets=new Map<number,PlayEntry[]>();
 for(const entry of entries){if(!Number.isFinite(entry.playedAt))continue;const d=new Date(entry.playedAt+shift),weekday=d.getUTCDay();if(weekday===6)continue;d.setUTCHours(0,0,0,0);const release=d.getTime()-shift+(6-weekday)*day;if(release>latest||saved.has(release))continue;const list=buckets.get(release)||[];list.push(entry);buckets.set(release,list);}
 for(const [release,plays]of buckets)saved.set(release,{start:release-6*day,release,end:release+day,entries:structuredClone(plays)});
 return [...saved.values()].filter(s=>s.release<=latest).sort((a,b)=>b.release-a.release);
}
