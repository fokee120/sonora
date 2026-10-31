export interface CaptureProgress {
  phase: 'preparing' | 'fetching' | 'recording' | 'finalizing' | 'waiting_transfer' | 'transferring' | 'failed' | 'cancelled' | 'completed';
  downloadedBytes?: number;
  totalBytes?: number;
  progress: number;
  recordedSeconds: number;
  sourceDuration: number;
}
interface Job { session: string; state: CaptureProgress; expires: number }
const jobs = new Map<string, Job>();
export const validDownloadRequestId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const terminal=(phase:CaptureProgress['phase'])=>phase==='completed'||phase==='failed'||phase==='cancelled';
function prune() { for (const [id, job] of jobs) if (job.expires <= Date.now()) jobs.delete(id); }
export function beginDownloadJob(id: string, session: string): void {
  prune();
  if (jobs.has(id)) throw Object.assign(new Error('Download request identifier already in use'), { status: 409 });
  // Retained results are diagnostics, not occupied download slots. Evict only
  // terminal records; active preparation/transfer progress must stay available.
  if(jobs.size>=128)for(const [oldId,job] of jobs){if(terminal(job.state.phase))jobs.delete(oldId);if(jobs.size<128)break;}
  if (jobs.size >= 128) throw Object.assign(new Error('Download progress capacity reached; retry shortly'), { status: 503, code:'download_capacity_reached' });
  jobs.set(id, { session, expires: Date.now() + 11 * 60_000, state: { phase: 'preparing', progress: 0, recordedSeconds: 0, sourceDuration: 0 } });
}
export function updateDownloadJob(id: string, phase: CaptureProgress['phase'], position?: number, duration?: number): void {
  const job = jobs.get(id); if (!job || terminal(job.state.phase)) return;
  job.state.phase = phase;
  if (phase === 'recording' && Number.isFinite(position) && Number.isFinite(duration) && duration! > 0) {
    job.state.recordedSeconds = Math.max(0, Math.min(position!, duration!));
    job.state.sourceDuration = duration!;
    job.state.progress = Math.min(95, Math.floor(job.state.recordedSeconds / duration! * 95));
  }
  if (terminal(phase)) job.expires = Date.now() + 2 * 60_000;
  if(phase==='completed')job.state.progress=100;
}
// Direct provider supplies explicit byte-derived progress, never elapsed recording time.
export function reportDownloadJob(id: string, state: CaptureProgress): void {
  const job = jobs.get(id); if (!job || terminal(job.state.phase)) return;
  job.state = { ...state, progress: Math.max(0, Math.min(95, state.progress)), recordedSeconds: state.recordedSeconds ?? 0, sourceDuration: state.sourceDuration ?? 0 };
}
export function readDownloadJob(id: string, session: string): CaptureProgress | undefined {
  prune(); const job = jobs.get(id);
  return job?.session === session ? { ...job.state } : undefined;
}
const cleanup = setInterval(prune, 60_000); cleanup.unref();
