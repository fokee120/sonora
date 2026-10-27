/** FIFO slots for sending finalized audio to devices. */
export class TransferSlots {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.active >= this.limit) await new Promise<void>((resolve, reject) => {
      const ready = () => { signal.removeEventListener('abort', abort); resolve(); };
      const abort = () => { this.waiters = this.waiters.filter(item => item !== ready); reject(signal.reason); };
      this.waiters.push(ready); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    else this.active++;
    let released = false;
    return () => { if (released) return; released = true; const next = this.waiters.shift(); if (next) next(); else this.active--; };
  }
}
