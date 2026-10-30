import { getDB, dbService } from '../db.js';
import { fetchYoutubeAudio } from '../audio/audioSource.js';
import { validateAudioBlob } from './audioCompleteness.js';
import { cacheArtwork } from '../artwork.js';
import type { Track } from '../../types/index.js';
type CacheMeta = { trackId: string; size: number; cachedAt: number; lastPlayedAt: number };
const META_KEY = 'auto_audio_metadata_v1';
class AudioCache {
    constructor() {
        window.addEventListener('sonora:download-complete', event => {
            const id = (event as CustomEvent<string>).detail;
            void this.removeDownloaded(id).catch(() => {});
        });
    }
    private async removeDownloaded(id: string) {
        await this.ready;
        this.jobs.delete(id); this.failed.delete(id);
        const remove = this.writes.then(async () => {
            const db = await getDB();
            if ((await db.get('downloads', id))?.status !== 'completed' || !await dbService.hasAudioBlob(id)) return;
            await db.delete('autoAudio', id);
            this.ids.delete(id); this.metadata.delete(id);
            await this.saveMetadata();
        });
        this.writes = remove.catch(() => {});
        await remove; this.emit();
    }
    private jobs = new Map<string, {
        track: Track;
        priority: number;
    }>();
    private attempted = new Set<string>();
    private active = new Map<string, Promise<Blob>>();
    private running = false;
    private lastError = '';
    private failed=new Map<string,Track>();
    retryFailed(){this.lastError='';for(const track of this.failed.values()){this.attempted.delete(track.id);this.jobs.set(track.id,{track,priority:1});}this.failed.clear();void this.pump();}
    private generation = 0;
    private writes: Promise<void> = Promise.resolve();
    private playedAt = new Map<string, number>();
    private current = '';
    private ids = new Set<string>();
    private metadata = new Map<string, CacheMeta>();
    has(id: string) { return this.ids.has(id); }
    private limit = 2 * 1024 ** 3;
    private ready = this.initialize();
    private async initialize() {
        const db = await getDB();
        this.limit = (await dbService.getSetting<number>('audio_cache_gb', 2)) * 1024 ** 3;
        const keys = await db.getAllKeys('autoAudio');
        const saved = await dbService.getSetting<CacheMeta[]>(META_KEY, []);
        const existing = new Map((Array.isArray(saved) ? saved : []).filter(item => item && typeof item.trackId === 'string' && Number.isFinite(item.size)).map(item => [item.trackId, item]));
        let changed = existing.size !== keys.length;
        for (const id of keys) {
            if ((await db.get('downloads', id))?.status === 'completed' && await dbService.hasAudioBlob(id)) {
                await db.delete('autoAudio', id); changed = true; continue;
            }
            let meta = existing.get(id);
            if (!meta) {
                const record = await db.get('autoAudio', id);
                if (!record) continue;
                meta = { trackId: id, size: record.size, cachedAt: record.cachedAt, lastPlayedAt: record.lastPlayedAt || 0 };
                changed = true;
            }
            this.metadata.set(id, meta); this.ids.add(id);
        }
        if (changed) await this.saveMetadata();
        for (const play of await dbService.getPlayHistory(300)) this.playedAt.set(play.trackId, Math.max(play.playedAt, this.playedAt.get(play.trackId) || 0));
    }
    private async saveMetadata() { await dbService.setSetting(META_KEY, [...this.metadata.values()]); }
    private emit() { window.dispatchEvent(new Event('sonora:cache-changed')); }
    async stats() { await this.ready; return { bytes: [...this.metadata.values()].reduce((n, r) => n + r.size, 0), count: this.metadata.size, gb: this.limit / 1024 ** 3, queued: this.jobs.size, working: this.active.size, error: this.lastError, failed: this.failed.size }; }
    async setLimit(gb: number) { if (!Number.isFinite(gb) || gb < 0 || gb > 100)
        throw Error('Choose between 0 and 100 GB'); await this.ready; this.limit = gb * 1024 ** 3; await dbService.setSetting('audio_cache_gb', gb); const clean = this.writes.then(() => this.prune(0)); this.writes = clean.catch(() => { }); await clean; this.emit(); if (gb)
        void this.pump(); }
    async get(id: string) { const r = await (await getDB()).get('autoAudio', id); return r ? new Blob([r.bytes], { type: r.mimeType }) : null; }
    async played(track: Track) { this.current = track.id; const playedAt = Date.now(); this.playedAt.set(track.id, playedAt); await dbService.saveTracks([track]); await this.ready; const touch = this.writes.then(async () => { const meta = this.metadata.get(track.id); if (meta) { this.metadata.set(track.id, { ...meta, lastPlayedAt: playedAt }); await this.saveMetadata(); } }); this.writes = touch.catch(() => {}); await touch; if (!this.ids.has(track.id)) this.attempted.delete(track.id); this.enqueue([track], 0); }
    enqueue(tracks: Track[], priority = 2) { for (const track of tracks)
        if ((track.source === 'ytmusic' || track.id.startsWith('ytm:')) && !this.attempted.has(track.id)) {
            const previous = this.jobs.get(track.id);
            this.jobs.set(track.id, { track, priority: Math.min(priority, previous?.priority ?? priority) });
        } void this.pump(); }
    private async prune(incoming: number) { const db = await getDB(); const records = [...this.metadata.values()]; let used = records.reduce((n, r) => n + r.size, 0); records.sort((a, b) => (a.lastPlayedAt - b.lastPlayedAt) || (a.cachedAt - b.cachedAt)); for (const r of records) {
        if (used + incoming <= this.limit)
            break;
        if (r.trackId === this.current && this.limit > 0 && incoming > 0)
            continue;
        await db.delete('autoAudio', r.trackId);
        this.ids.delete(r.trackId);
        this.metadata.delete(r.trackId);
        used -= r.size;
    } await this.saveMetadata(); if (used + incoming > this.limit)
        throw Error('Cache limit reached'); }
    async clear() { this.lastError='';this.failed.clear();this.generation++; this.jobs.clear(); await this.ready; await this.writes; await (await getDB()).clear('autoAudio'); this.ids.clear(); this.metadata.clear(); await this.saveMetadata(); this.emit(); }
    async ensure(track: Track, signal?: AbortSignal): Promise<Blob> {
        await this.ready;
        signal?.throwIfAborted();
        const download = await (await getDB()).get('downloads', track.id);
        if (download?.status === 'completed') {
            const blob = await dbService.getAudioBlob(track.id);
            if (blob)
                return blob;
        }
        const existing = await this.get(track.id);
        if (existing) return existing;
        const pending = this.active.get(track.id);
        if (pending)
            return pending;
        const generation = this.generation;
        const task = (async () => {
            const response = await fetchYoutubeAudio(track, signal, true);
            const reader = response.body?.getReader();
            if (!reader)
                throw Error('Empty audio');
            const maximum = Math.min(this.limit || 32 * 1024 ** 2, 32 * 1024 ** 2);
            let size = 0;
            const parts: Uint8Array<ArrayBuffer>[] = [];
            while (true) {
                const part = await reader.read();
                if (part.done)
                    break;
                size += part.value.length;
                if (size > maximum) {
                    await reader.cancel();
                    throw Error('Song exceeds cache limit');
                }
                parts.push(new Uint8Array(part.value));
            }
            const blob = new Blob(parts, { type: response.headers.get('Content-Type') || 'audio/mpeg' });
            await validateAudioBlob(blob, track, signal, response);
            signal?.throwIfAborted();
            const commit = async () => {
                if (!this.limit || generation !== this.generation || blob.size > this.limit) return;
                const db = await getDB();
                // A download may finish while the same song is still being fetched
                // for automatic caching. Recheck at commit, inside the write queue.
                if ((await db.get('downloads', track.id))?.status === 'completed' && await dbService.hasAudioBlob(track.id)) return;
                if (await db.get('autoAudio', track.id)) return;
                await this.prune(blob.size);
                const meta = {trackId: track.id, size: blob.size, cachedAt: Date.now(), lastPlayedAt: this.playedAt.get(track.id) || 0};
                await db.put('autoAudio', {...meta, bytes: await blob.arrayBuffer(), mimeType: blob.type});
                this.ids.add(track.id); this.metadata.set(track.id, meta);
                await this.saveMetadata(); void cacheArtwork(track); this.emit();
            };
            const saved = this.writes.then(commit);
            this.writes = saved.catch(() => { });
            // Playback needs the validated bytes, not the completion of a
            // potentially busy IndexedDB write queue. Persist independently.
            void saved.catch(error=>{this.lastError=error instanceof Error?error.message:'Could not save audio cache';this.emit();});
            return blob;
        })().finally(() => { this.active.delete(track.id); this.emit(); });
        this.active.set(track.id, task);
        return task;
    }
    private async pump() { await this.ready; if (this.running || !this.limit || !navigator.onLine)
        return; this.running = true; try {
        while (this.jobs.size && this.limit && navigator.onLine) {
            const job = [...this.jobs.values()].sort((a, b) => a.priority - b.priority)[0];
            this.jobs.delete(job.track.id);
            const download = await dbService.getDownloadState(job.track.id);
            if (download?.status === 'completed' && await dbService.hasAudioBlob(job.track.id)) {
                this.failed.delete(job.track.id); continue;
            }
            this.attempted.add(job.track.id);
            try {
                if(!this.ids.has(job.track.id))await this.ensure(job.track); this.failed.delete(job.track.id);
            }
            catch { this.failed.set(job.track.id,job.track); /* Source outages must not interrupt playback. */ }
            this.emit();
        }
    }
    finally {
        this.running = false;
    } }
}
export const audioCache = new AudioCache();
