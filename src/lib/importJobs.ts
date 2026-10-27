import { dbService } from './db.js';
import { fetchImportedPlaylist, type ImportedPlaylist } from './playlistImport.js';
import { cachedSearchYoutubeMusic, ytmSongToTrack } from './ytmusic/youtubeMusic.js';
import { matchImportedTrack } from './recommendations.js';
import type { Track } from '../types/index.js';
export type ImportJob = {
    playlistId: string;
    playlist: ImportedPlaylist;
    cursor: number;
    missing: number;
    missingEntries?: import('./playlistImport.js').ImportedTrack[];
    status: 'running' | 'done' | 'failed';
    error?: string;
};
let busy = false;
export const jobsChanged = () => window.dispatchEvent(new Event('sonora:imports-changed'));
async function save(jobs: ImportJob[]) { await dbService.setSetting('playlist_import_jobs', jobs); jobsChanged(); }
async function saveJob(job: ImportJob) { const jobs = await dbService.getSetting<ImportJob[]>('playlist_import_jobs', []); const index = jobs.findIndex(j => j.playlistId === job.playlistId); if (index >= 0)
    jobs[index] = job;
else
    jobs.push(job); await save(jobs); }
export async function startImport(playlistId: string, playlist: ImportedPlaylist) { const jobs = await dbService.getSetting<ImportJob[]>('playlist_import_jobs', []); if (jobs.some(j => j.playlistId === playlistId && j.status === 'running'))
    throw Error('This playlist is already syncing'); const existing = await dbService.getPlaylist(playlistId); if (existing)
    await dbService.savePlaylist({ ...existing, source: { type: playlist.source, id: playlist.sourceId, syncedAt: existing.source?.syncedAt } }); const job = { playlistId, playlist, cursor: 0, missing: 0, missingEntries: [] as import('./playlistImport.js').ImportedTrack[], status: 'running' as const }; const next = jobs.filter(j => j.playlistId !== playlistId); next.push(job); await save(next); void resumeImports(); }
export async function syncPlaylist(id: string) { const p = await dbService.getPlaylist(id); if (!p?.source)
    return; if (p.source.type === 'file') { const jobs = await dbService.getSetting<ImportJob[]>('playlist_import_jobs', []); const existing = jobs.find(job => job.playlistId === id); if (existing) { await startImport(id, existing.playlist); return; } } const source = await fetchImportedPlaylist({ source: p.source.type, id: p.source.id }); await startImport(id, source); }
export async function resumeImports() { if (busy || !navigator.onLine)
    return; busy = true; try {
    const jobs = await dbService.getSetting<ImportJob[]>('playlist_import_jobs', []);
    for (const job of jobs) {
        if (job.status !== 'running')
            continue;
        try {
            while (job.cursor < job.playlist.tracks.length && navigator.onLine) {
                const entries = job.playlist.tracks.slice(job.cursor, job.cursor + 10);
                const found: Track[] = [];
                for (const entry of entries) {
                    if (entry.videoId && /^[\w-]{11}$/.test(entry.videoId)) {
                        found.push(ytmSongToTrack({ videoId: entry.videoId, title: entry.title, artist: entry.artist, album: entry.album, durationSeconds: entry.durationSeconds || 0, thumbnailUrl: entry.artworkUrl }));
                        continue;
                    }
                    try {
                        const results = await cachedSearchYoutubeMusic(`${entry.title} ${entry.artist}`, 'songs');
                        const best = matchImportedTrack(entry, results);
                        if (best) {
                            found.push(best.track);
                        } else {
                            job.missing++;
                            (job.missingEntries ||= []).push(entry);
                        }
                    }
                    catch {
                        job.missing++;
                        (job.missingEntries ||= []).push(entry);
                    }
                }
                await dbService.saveTracks(found);
                const p = await dbService.getPlaylist(job.playlistId);
                if (!p) {
                    job.status = 'done';
                    break;
                }
                await dbService.mutatePlaylist(job.playlistId, latest => ({ ...latest, trackIds: [...new Set([...latest.trackIds, ...found.map(t => t.id)])], source: { type: job.playlist.source, id: job.playlist.sourceId, syncedAt: Date.now() }, updatedAt: Date.now() }));
                job.cursor += entries.length;
                await saveJob(job);
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            if (job.cursor >= job.playlist.tracks.length)
                job.status = 'done';
        }
        catch (e) {
            job.status = 'failed';
            job.error = e instanceof Error ? e.message : String(e);
        }
        job.missing = (job.missingEntries || []).length;
        await saveJob(job);
    }
}
finally {
    busy = false;
} }
let missingUpdates: Promise<void> = Promise.resolve();
function queueMissingUpdate(action: () => Promise<void>): Promise<void> { const operation = missingUpdates.then(action); missingUpdates = operation.catch(() => {}); return operation; }
export function manuallyMatchMissing(playlistId: string, entry: import('./playlistImport.js').ImportedTrack, track: Track): Promise<void> { return queueMissingUpdate(async () => { await dbService.saveTracks([track]); await dbService.mutatePlaylist(playlistId, playlist => ({ ...playlist, trackIds: [...new Set([...playlist.trackIds, track.id])], updatedAt: Date.now() })); const jobs = await dbService.getSetting<ImportJob[]>('playlist_import_jobs', []); const job = jobs.find(item => item.playlistId === playlistId); if (!job) return; job.missingEntries = (job.missingEntries || []).filter(item => !(item.title === entry.title && item.artist === entry.artist)); job.missing = job.missingEntries.length; await save(jobs); }); }
export function dismissMissing(playlistId: string, entry: import('./playlistImport.js').ImportedTrack): Promise<void> { return queueMissingUpdate(async () => { const jobs = await dbService.getSetting<ImportJob[]>('playlist_import_jobs', []); const job = jobs.find(item => item.playlistId === playlistId); if (!job) return; job.missingEntries = (job.missingEntries || []).filter(item => !(item.title === entry.title && item.artist === entry.artist)); job.missing = job.missingEntries.length; await save(jobs); }); }
let syncing = false;
export async function autoSyncImports() { if (syncing || busy || !navigator.onLine)
    return; syncing = true; try {
    const jobs = await dbService.getSetting<ImportJob[]>('playlist_import_jobs', []);
    for (const p of await dbService.getAllPlaylists()) {
        if (p.source && p.source.type !== 'spotify' && p.source.type !== 'file' && Date.now() - (p.source.syncedAt || 0) > 15 * 60000 && !jobs.some(j => j.playlistId === p.id && j.status === 'running')) {
            try {
                await syncPlaylist(p.id);
            }
            catch { /* Retry next foreground interval. */ }
        }
    }
}
finally {
    syncing = false;
} }
