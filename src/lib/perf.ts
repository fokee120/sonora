export const debugPerf =
  typeof import.meta !== 'undefined' &&
  (import.meta as any).env?.VITE_DEBUG_PERF === 'true';

export function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function logPerf(label: string, startedAt: number, extra?: Record<string, unknown>): void {
  if (!debugPerf) return;
  const elapsed = Math.round(perfNow() - startedAt);
  console.debug(`[perf] ${label}: ${elapsed}ms`, extra || '');
}
