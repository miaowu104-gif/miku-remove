// Duration probing without a decoder.

import fs from 'node:fs';
import path from 'node:path';

const MP3_BITRATES = [null, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, null];
const MP3_RATES = [44100, 48000, 32000, null];

export function flacDuration(file) {
  let head;
  try {
    const fd = fs.openSync(file, 'r');
    head = Buffer.alloc(42);
    const n = fs.readSync(fd, head, 0, 42, 0);
    fs.closeSync(fd);
    if (n < 42) return null;
  } catch {
    return null;
  }
  if (head.subarray(0, 4).toString('latin1') !== 'fLaC') return null;
  try {
    const bits = head.readBigUInt64BE(18);          // body[10:18]
    const rate = Number((bits >> 44n) & 0xfffffn);
    const total = Number(bits & 0xfffffffffn);
    return rate ? total / rate : null;
  } catch {
    return null;
  }
}

export function mp3Duration(file) {
  let data;
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(10);
    fs.readSync(fd, head, 0, 10, 0);
    let pos = 0;
    if (head.subarray(0, 3).toString('latin1') === 'ID3') {
      const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14)
        | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
      pos = 10 + size;
    }
    const stat = fs.fstatSync(fd);
    const len = stat.size - pos;
    data = Buffer.alloc(len);
    fs.readSync(fd, data, 0, len, pos);
    fs.closeSync(fd);
  } catch {
    return null;
  }
  let total = 0;
  let i = 0;
  const n = data.length;
  while (i + 4 <= n) {
    if (data[i] !== 0xff || (data[i + 1] & 0xe0) !== 0xe0) { i += 1; continue; }
    const ver = (data[i + 1] >> 3) & 3;
    const layer = (data[i + 1] >> 1) & 3;
    const bri = (data[i + 2] >> 4) & 0xf;
    const sri = (data[i + 2] >> 2) & 3;
    const pad = (data[i + 2] >> 1) & 1;
    if (ver !== 3 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) { i += 1; continue; }
    const rate = MP3_RATES[sri];
    const flen = Math.trunc((144 * MP3_BITRATES[bri] * 1000) / rate) + pad;
    if (flen <= 4) { i += 1; continue; }
    total += 1152 / rate;
    i += flen;
  }
  return total || null;
}

export function wavDuration(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    if (head.subarray(0, 4).toString('latin1') !== 'RIFF'
      || head.subarray(8, 12).toString('latin1') !== 'WAVE') { fs.closeSync(fd); return null; }
    let off = 12;
    let byteRate = 0;
    let dataSize = 0;
    const stat = fs.fstatSync(fd);
    while (off + 8 <= stat.size) {
      const hdr = Buffer.alloc(8);
      fs.readSync(fd, hdr, 0, 8, off);
      const id = hdr.subarray(0, 4).toString('latin1');
      const size = hdr.readUInt32LE(4);
      if (id === 'fmt ') {
        const fmt = Buffer.alloc(Math.min(size, 16));
        fs.readSync(fd, fmt, 0, fmt.length, off + 8);
        byteRate = fmt.readUInt32LE(8);
      } else if (id === 'data') {
        dataSize = size;
        break;
      }
      off += 8 + size + (size % 2);
    }
    fs.closeSync(fd);
    return byteRate ? dataSize / byteRate : null;
  } catch {
    return null;
  }
}

export function mediaDuration(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.flac') {
    const d = flacDuration(file);
    if (d) return d;
  }
  if (ext === '.mp3' || ext === '.mp2' || ext === '.mpa') {
    const d = mp3Duration(file);
    if (d) return d;
  }
  return wavDuration(file);
}
