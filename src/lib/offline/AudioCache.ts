import { getDB, dbService } from '../db.js';
import { isYoutubeTrack, youtubeVideoId } from '../ytmusic/youtubeMusic.js';
import { getConnectionState, subscribeConnection, isServerOnline } from '../serverConnection.js';
import { cacheArtwork } from '../artwork.js';
import type { Track } from '../../types/index.js';
type CacheMeta = { trackId: string; size: number; cachedAt: number; lastPlayedAt: number; asset?: string; expires?: number };
const META_KEY = 'auto_audio_prefix_metadata_v3';
const MAX_PREFIX = 768 * 1024;
class AudioCache {
    constructor() {
        subscribeConnection(() => { if (isServerOnline()) void this.pump(); });
        window.addEventListener('online', () => void this.pump());
        window.addEventListener('sonora:download-complete', event => {
            const id = (event as CustomEvent<string>).detail;
            void this.removeDownloaded(id).catch(() => {});
        });
    }
    private async removeDownloaded(id: string) {
        await this.ready;
        this.active.get(id)?.abort();
        this.jobs.delete(id); this.searchJobs.delete(id); this.failed.delete(id);
        const remove = this.writes.then(async () => {
            const db = await getDB();
            if ((await db.get('downloads', id))?.status !== 'completed' || !await dbService.hasAudioBlob(id)) return;
            await db.delete('autoAudio', id);
            this.metadata.delete(id);
            await this.saveMetadata();
        });
        this.writes = remove.catch(() => {});
        await remove; this.emit();
    }
    private jobs = new Map<string, {
        track: Track;
        priority: number;
    }>();
    private searchJobs = new Map<string, { track: Track; signal: AbortSignal }>();
    private attempted = new Set<string>();
    private active = new Map<string, AbortController>();
    private lastError = '';
    private failed=new Map<string,Track>();
    retryFailed(){this.lastError='';for(const track of this.failed.values()){this.attempted.delete(track.id);this.jobs.set(track.id,{track,priority:1});}this.failed.clear();void this.pump();}
    private generation = 0;
    private writes: Promise<void> = Promise.resolve();
    private playedAt = new Map<string, number>();
    private current = '';
    private metadata = new Map<string, CacheMeta>();
    private limit = 2 * 1024 ** 3;
    private ready = this.initialize();
    private async initialize() {
        const db = await getDB();
        this.limit = (await dbService.getSetting<number>('audio_cache_gb', 2)) * 1024 ** 3;
        const migration = db.transaction(['autoAudio', 'settings'], 'readwrite');
        const settings = migration.objectStore('settings');
        if (!(await settings.get(META_KEY))) {
            // Prefix bytes now stay beside the encoder. Remove older automatic
            // copies without touching explicitly downloaded audio.
            await migration.objectStore('autoAudio').clear();
            await settings.put({ key: META_KEY, value: [], updatedAt: Date.now() });
        }
        await migration.done;
        const keys = await db.getAllKeys('autoAudio');
        const saved = await dbService.getSetting<CacheMeta[]>(META_KEY, []);
        const existing = new Map((Array.isArray(saved) ? saved : []).filter(item => item && typeof item.trackId === 'string' && Number.isFinite(item.size)).map(item => [item.trackId, item]));
        let changed = existing.size !== keys.length;
        for (const id of keys) {
            if ((await db.get('downloads', id))?.status === 'completed' && await dbService.hasAudioBlob(id)) {
                await db.delete('autoAudio', id); changed = true; continue;
            }
            let meta = existing.get(id);
            if (meta?.expires && meta.expires <= Date.now()) { await db.delete('autoAudio', id); changed = true; continue; }
            if (!meta) {
                const record = await db.get('autoAudio', id);
                if (!record?.asset || !record.expires || record.expires <= Date.now()) {
                    await db.delete('autoAudio', id); changed = true; continue;
                }
                meta = { trackId: id, size: record.size, cachedAt: record.cachedAt, lastPlayedAt: record.lastPlayedAt || 0, asset: record.asset, expires: record.expires };
                changed = true;
            }
            this.metadata.set(id, meta);
        }
        if (changed) await this.saveMetadata();
        for (const play of await dbService.getPlayHistory(300)) this.playedAt.set(play.trackId, Math.max(play.playedAt, this.playedAt.get(play.trackId) || 0));
    }
    private async saveMetadata() { await dbService.setSetting(META_KEY, [...this.metadata.values()]); }
    private emit() { window.dispatchEvent(new Event('sonora:cache-changed')); }
    async stats() {
        await this.ready;
        const prepared = [...this.metadata.values()].filter(meta => this.usablePrefix(meta.trackId));
        return { bytes: prepared.reduce((n, r) => n + r.size, 0), count: prepared.length, gb: this.limit / 1024 ** 3,
            queued: new Set([...this.jobs.keys(), ...this.searchJobs.keys()]).size, working: this.active.size, error: this.lastError, failed: this.failed.size };
    }
    async setLimit(gb: number) { if (!Number.isFinite(gb) || gb < 0 || gb > 100)
        throw Error('Choose between 0 and 100 GB'); await this.ready; this.limit = gb * 1024 ** 3; await dbService.setSetting('audio_cache_gb', gb); const clean = this.writes.then(() => this.prune(0)); this.writes = clean.catch(() => { }); await clean; this.emit(); if (gb)
        void this.pump(); }
    private usablePrefix(id: string) {
        const record = this.metadata.get(id);
        const generation = getConnectionState().audioCacheGeneration;
        if (generation && !record?.asset?.startsWith(generation + '.')) return;
        return record?.asset && record.expires && record.expires > Date.now() ? record : undefined;
    }
    async played(track: Track) { this.current = track.id; this.jobs.delete(track.id); this.searchJobs.delete(track.id); const playedAt = Date.now(); this.playedAt.set(track.id, playedAt); await dbService.saveTracks([track]); await this.ready; const touch = this.writes.then(async () => { const meta = this.metadata.get(track.id); if (meta) { this.metadata.set(track.id, { ...meta, lastPlayedAt: playedAt }); await this.saveMetadata(); } }); this.writes = touch.catch(() => {}); await touch; }
    enqueue(tracks: Track[], priority = 2) { for (const track of tracks)
        if (isYoutubeTrack(track) && track.id !== this.current && (!this.attempted.has(track.id) || (this.metadata.has(track.id) && !this.usablePrefix(track.id)))) {
            const previous = this.jobs.get(track.id);
            this.jobs.set(track.id, { track, priority: Math.min(priority, previous?.priority ?? priority) });
        } void this.pump(); }
    enqueueSearch(tracks: Track[], signal: AbortSignal) {
        if (signal.aborted) return;
        const matches = new Set<string>();
        for (const track of tracks) {
            if (!isYoutubeTrack(track)) continue;
            const video = youtubeVideoId(track);
            if (!/^[\w-]{11}$/.test(video) || matches.has(video)) continue;
            matches.add(video);
            if (track.id !== this.current && !this.usablePrefix(track.id)) {
                this.searchJobs.set(track.id, { track, signal });
            }
            if (matches.size === 2) break;
        }
        signal.addEventListener('abort', () => {
            for (const [id, job] of this.searchJobs) if (job.signal === signal) this.searchJobs.delete(id);
        }, { once: true });
        void this.pump();
    }
    private async prune(incoming: number) { const db = await getDB(); const records = [...this.metadata.values()]; let used = records.reduce((n, r) => n + r.size, 0); records.sort((a, b) => (a.lastPlayedAt - b.lastPlayedAt) || (a.cachedAt - b.cachedAt)); for (const r of records) {
        const usable = this.usablePrefix(r.trackId);
        if (usable && (used + incoming <= this.limit || (r.trackId === this.current && this.limit > 0 && incoming > 0)))
            continue;
        await db.delete('autoAudio', r.trackId);
        this.metadata.delete(r.trackId);
        used -= r.size;
    } await this.saveMetadata(); if (used + incoming > this.limit)
        throw Error('Cache limit reached'); }
    async clear() { this.lastError='';this.failed.clear();this.generation++; this.jobs.clear(); this.searchJobs.clear(); this.attempted.clear(); for (const controller of this.active.values()) controller.abort(); await this.ready; await this.writes; await (await getDB()).clear('autoAudio'); this.metadata.clear(); await this.saveMetadata(); this.emit(); }
    private async cachePrefix(track: Track, seconds: 5 | 15, jobSignal: AbortSignal) {
        const videoId = youtubeVideoId(track);
        if (!/^[\w-]{11}$/.test(videoId)) return;
        const generation = this.generation;
        const signal = AbortSignal.any([jobSignal, AbortSignal.timeout(25_000)]);
        const response = await fetch('/api/ytmusic/prefix/' + videoId + (seconds === 5 ? '?seconds=5' : ''), {
            cache: 'no-store', signal, priority: 'low',
        });
        if (response.status === 422 || response.status === 404) { await response.body?.cancel(); return; }
        const asset = response.headers.get('X-Audio-Asset');
        const expires = Number(response.headers.get('X-Audio-Expires'));
        const size = Number(response.headers.get('X-Audio-Prefix-Bytes'));
        if (response.status !== 204 || !asset || !Number.isFinite(expires) || expires <= Date.now()
            || !Number.isSafeInteger(size) || size <= 0 || size > MAX_PREFIX) {
            await response.body?.cancel();
            throw new Error('Invalid audio prefix receipt');
        }
        const saved = this.writes.then(async () => {
            if (signal.aborted || !this.limit || generation !== this.generation || size > this.limit) return;
            const db = await getDB();
            if ((await db.get('downloads', track.id))?.status === 'completed' && await dbService.hasAudioBlob(track.id)) return;
            if (this.metadata.has(track.id)) {
                await db.delete('autoAudio', track.id);
                this.metadata.delete(track.id);
            }
            await this.prune(size);
            if (signal.aborted || generation !== this.generation) return;
            const meta = { trackId: track.id, size, cachedAt: Date.now(), lastPlayedAt: this.playedAt.get(track.id) || 0, asset, expires };
            await db.put('autoAudio', meta);
            this.metadata.set(track.id, meta);
            await this.saveMetadata();
            void cacheArtwork(track);
        });
        this.writes = saved.catch(() => {});
        await saved;
    }

    private async runJob(track: Track, controller: AbortController, searchSignal?: AbortSignal) {
        const signal = searchSignal ? AbortSignal.any([controller.signal, searchSignal]) : controller.signal;
        try {
            const downloaded = (await dbService.getDownloadState(track.id))?.status === 'completed'
                && await dbService.hasAudioBlob(track.id);
            if (downloaded || this.usablePrefix(track.id)) {
                this.failed.delete(track.id);
                return;
            }
            if (!this.limit || track.id === this.current || signal.aborted) return;
            if (!searchSignal) this.attempted.add(track.id);
            await this.cachePrefix(track, searchSignal ? 5 : 15, signal);
            this.failed.delete(track.id);
        } catch (error) {
            if (searchSignal || signal.aborted || (error as Error)?.name === 'AbortError') return;
            this.failed.set(track.id, track);
            this.lastError = error instanceof Error ? error.message : 'Audio precache failed';
        } finally {
            this.active.delete(track.id);
            this.emit();
            void this.pump();
        }
    }

    private async pump() {
        await this.ready;
        while (this.active.size < 2 && this.limit && isServerOnline()) {
            const searchJob = [...this.searchJobs.values()].find(({ track }) => !this.active.has(track.id));
            // Only search can use both request slots. Existing background caching
            // remains serial and resumes once the previews are ready.
            if (!searchJob && this.active.size) return;
            const job = searchJob ?? [...this.jobs.values()].sort((a, b) => a.priority - b.priority)[0];
            if (!job) return;
            const { track } = job;
            if (searchJob) this.searchJobs.delete(track.id);
            else this.jobs.delete(track.id);

            const controller = new AbortController();
            this.active.set(track.id, controller);
            void this.runJob(track, controller, searchJob?.signal);
        }
    }
}
export const audioCache = new AudioCache();
