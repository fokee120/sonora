/** Byte-only duration for Sonora's legacy Opus/WebM recordings, including
 * live/unknown-size segments. Never opens another native audio session. */
export function readWebmDuration(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function vint(at: number, id = false) {
    const first = bytes[at];
    if (!first) throw new Error('Invalid WebM element');
    let width = 1, marker = 0x80;
    while (!(first & marker)) { width++; marker >>= 1; }
    if (width > (id ? 4 : 8) || at + width > bytes.length) throw new Error('Truncated WebM element');
    let value = id ? first : first & (marker - 1);
    let unknown = !id && value === marker - 1;
    for (let i = 1; i < width; i++) { value = value * 256 + bytes[at + i]; unknown = unknown && bytes[at + i] === 255; }
    return { value, width, unknown };
  }
  function uint(start: number, end: number) {
    let n = 0; for (let p = start; p < end; p++) n = n * 256 + bytes[p]; return n;
  }
  let scale = 1_000_000, cluster = 0, lastEnd = 0;
  let track = -1, codec = '', codecDelay = 0;
  const decoder = new TextDecoder();
  // Only the actual Opus audio track contributes to the measured duration.
  function packetDuration(at: number, end: number) {
    if (at >= end) throw new Error('Empty Opus packet');
    const toc = bytes[at], config = toc >> 3;
    const frameMs = config >= 16 ? 2.5 * 2 ** (config & 3) : config >= 12 ? 10 * 2 ** (config & 1) : (config & 3) === 3 ? 60 : 10 * 2 ** (config & 3);
    const code = toc & 3;
    if (code === 3 && at + 1 >= end) throw new Error('Truncated Opus packet');
    const count = code === 0 ? 1 : code === 3 ? bytes[at + 1] & 63 : 2;
    const duration = frameMs * count;
    if (!count || duration > 120) throw new Error('Invalid Opus packet duration');
    return duration / 1000;
  }
  function walk(start: number, end: number) {
    for (let at = start; at < end;) {
      const tag = vint(at, true); at += tag.width;
      const size = vint(at); at += size.width;
      const stop = size.unknown ? end : at + size.value;
      if (stop > end || stop < at) throw new Error('Truncated WebM audio');
      switch (tag.value) {
        case 0x18538067: case 0x1549a966: case 0x1654ae6b: case 0xa0:
          walk(at, stop); break;
        case 0x1f43b675:
          cluster = 0; walk(at, stop); break;
        case 0xae: {
          const previousTrack = track, previousCodec = codec, previousDelay = codecDelay;
          track = -1; codec = ''; codecDelay = 0; walk(at, stop);
          if (codec !== 'A_OPUS') { track = previousTrack; codec = previousCodec; codecDelay = previousDelay; }
          break;
        }
        case 0xd7: track = uint(at, stop); break;
        case 0x86: codec = decoder.decode(bytes.subarray(at, stop)); break;
        case 0x56aa: codecDelay = uint(at, stop) / 1e9; break;
        case 0x2ad7b1: scale = uint(at, stop); break;
        case 0xe7: cluster = uint(at, stop); break;
        case 0xa3: case 0xa1: {
          const number = vint(at);
          const header = at + number.width;
          if (header + 3 > stop) throw new Error('Truncated WebM block');
          if (number.value !== track || codec !== 'A_OPUS') break;
          // Sonora's MediaRecorder uses unlaced blocks. Reject unfamiliar lacing
          // rather than invent a duration and mark a broken download complete.
          if (bytes[header + 2] & 6) throw new Error('Unsupported WebM audio lacing');
          const timestamp = (cluster + view.getInt16(header)) * scale / 1e9;
          lastEnd = Math.max(lastEnd, timestamp + packetDuration(header + 3, stop));
          break;
        }
      }
      at = stop;
    }
  }
  walk(0, bytes.length);
  if (lastEnd <= 0) throw new Error('WebM audio duration could not be verified');
  return Math.max(0, lastEnd - codecDelay);
}
