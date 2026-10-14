/** One HTTP response = one recorder/container. Never drop or splice WebM bytes. */
export class AudioStream {
  private queue: Buffer[] = [];
  private readers: Array<{ resolve: (value: Buffer | null) => void; reject: (error: Error) => void }> = [];
  private readyWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  private error?: Error;
  ended = false;
  naturalEnd = false;
  bufferedBytes = 0;
  lastChunkAt = Date.now();
  receivedBytes = 0;
  onRecorded?: (position: number, duration: number) => void;
  constructor(readonly generation: number, private readonly limit = 1024 * 1024) {}
  push(chunk: Buffer): void {
    if (this.ended || !chunk.length) return;
    this.lastChunkAt = Date.now(); this.receivedBytes += chunk.length;
    for (const waiter of this.readyWaiters.splice(0)) waiter.resolve();
    const reader = this.readers.shift();
    if (reader) { reader.resolve(chunk); return; }
    if (this.bufferedBytes + chunk.length > this.limit) {
      this.end(new Error('Audio consumer too slow; reconnect with start=<position>'));
      return;
    }
    this.queue.push(chunk); this.bufferedBytes += chunk.length;
  }
  end(error?: Error): void {
    if (this.ended) return;
    this.ended = true; this.error = error;
    for (const waiter of this.readyWaiters.splice(0)) waiter.reject(error || new Error('Audio stream ended before receiving bytes'));
    if (error) { this.queue = []; this.bufferedBytes = 0; }
    for (const reader of this.readers.splice(0)) {
      if (error) reader.reject(error); else reader.resolve(null);
    }
  }
  waitForBytes(): Promise<void> {
    if (this.receivedBytes > 0) return Promise.resolve();
    if (this.ended) return Promise.reject(this.error || new Error('Audio stream ended before receiving bytes'));
    return new Promise((resolve, reject) => this.readyWaiters.push({ resolve, reject }));
  }
  next(): Promise<Buffer | null> {
    if (this.error) return Promise.reject(this.error);
    const chunk = this.queue.shift();
    if (chunk) { this.bufferedBytes -= chunk.length; return Promise.resolve(chunk); }
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve, reject) => this.readers.push({ resolve, reject }));
  }
}
