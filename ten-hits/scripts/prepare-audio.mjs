#!/usr/bin/env node
/**
 * Halves the sample rate of the authored contact recordings for the web build.
 *
 * They arrive as 48 kHz mono PCM. An impact is almost all low-frequency, so
 * 24 kHz keeps everything audible and halves the download. Nothing is trimmed:
 * the tail past the transient is the room, and cutting it makes the hit sound
 * like it happened in a box.
 *
 * Usage: node scripts/prepare-audio.mjs <src-dir> <out-dir> [name ...]
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** Half-band filter applied before dropping every second sample. */
const TAPS = [-0.0078, 0, 0.0645, 0.25, 0.3766, 0.25, 0.0645, 0, -0.0078];

function readWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a RIFF file');
  let offset = 12;
  let format = null;
  let samples = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = {
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14)
      };
    } else if (id === 'data') {
      samples = buffer.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  if (!format || !samples) throw new Error('missing fmt or data chunk');
  if (format.bits !== 16) throw new Error(`expected 16-bit, got ${format.bits}`);
  const pcm = new Int16Array(samples.byteLength / 2);
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = samples.readInt16LE(i * 2);
  return { ...format, pcm };
}

function writeWav({ channels, sampleRate, pcm }) {
  const header = Buffer.alloc(44);
  const dataBytes = pcm.length * 2;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  const body = Buffer.alloc(dataBytes);
  for (let i = 0; i < pcm.length; i += 1) body.writeInt16LE(pcm[i], i * 2);
  return Buffer.concat([header, body]);
}

/** Filters, then keeps every second sample. */
function halve(pcm) {
  const out = new Int16Array(Math.floor(pcm.length / 2));
  const mid = (TAPS.length - 1) / 2;
  for (let i = 0; i < out.length; i += 1) {
    const centre = i * 2;
    let sum = 0;
    for (let t = 0; t < TAPS.length; t += 1) {
      const k = centre + t - mid;
      if (k >= 0 && k < pcm.length) sum += pcm[k] * TAPS[t];
    }
    out[i] = Math.max(-32768, Math.min(32767, Math.round(sum)));
  }
  return out;
}

const [srcDir, outDir, ...only] = process.argv.slice(2);
if (!srcDir || !outDir) {
  console.error('usage: node scripts/prepare-audio.mjs <src-dir> <out-dir> [name ...]');
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const wanted = new Set(only);
const files = (await readdir(srcDir))
  .filter((f) => f.endsWith('.wav'))
  .filter((f) => wanted.size === 0 || wanted.has(basename(f, '.wav')));

let before = 0;
let after = 0;
for (const file of files.sort()) {
  const source = readWav(await readFile(join(srcDir, file)));
  if (source.channels !== 1) throw new Error(`${file}: expected mono`);
  const halved = {
    channels: 1,
    sampleRate: Math.round(source.sampleRate / 2),
    pcm: halve(source.pcm)
  };
  const out = writeWav(halved);
  await writeFile(join(outDir, file), out);
  before += source.pcm.length * 2;
  after += out.length;
  console.log(
    `${file.padEnd(26)} ${source.sampleRate}Hz -> ${halved.sampleRate}Hz  ` +
      `${(source.pcm.length * 2 / 1024).toFixed(0)}KB -> ${(out.length / 1024).toFixed(0)}KB`
  );
}
console.log(
  `\ntotal ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB ` +
    `(-${((1 - after / before) * 100).toFixed(0)}%)`
);
