/** Deterministic finite PCM tone; no remote catalog dependency. */
export function wave(seconds = 1.6): Buffer {
  const rate = 24000, samples = Math.floor(rate * seconds);
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let n = 0; n < samples; n++) data.writeInt16LE(Math.round(Math.sin(n * 2 * Math.PI * 440 / rate) * 8000), 44 + n * 2);
  return data;
}
