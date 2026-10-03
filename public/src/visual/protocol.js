// Sonik ekran/kamera protokolü, sürüm 1. Her standart QR ikili bir kare taşır:
// SONIK | sürüm | bayrak | aktarım no(8) | uzunluk(4) | parça boyu(2) | K(2)
//       | sıra/tohum(4) | içerik CRC(4) | parça | kare CRC(4)
// İlk K kare sistematiktir; devamındaki LT/XOR kurtarma kareleri kayıpları tamamlar.
// UR protokolünden bağımsızdır; iki cihazda da Sonik kullanılır.

import { crc32 } from '../codec/crc32.js';

export const MAX_VISUAL_FILE = 4 * 1024 * 1024;
export const MAX_VISUAL_CONTENT = MAX_VISUAL_FILE + 553; // nesne başlığı + AES-GCM
const HEADER = 31;
const MAGIC = [83, 79, 78, 73, 75];
const MAX_BLOCK = 512;
const distributions = new Map();

function random(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = Math.imul(x ^ (x >>> 15), x | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Robust soliton; çok büyük dereceyi 64'te topla, kamerada iş yükü sınırlı kalsın.
function degreeDistribution(k) {
  if (distributions.has(k)) return distributions.get(k);
  const max = Math.min(64, k);
  const weights = new Float64Array(max);
  const r = 0.1 * Math.log(k / 0.05) * Math.sqrt(k);
  const pivot = Math.max(1, Math.min(k, Math.floor(k / r)));
  for (let d = 1; d <= k; d++) {
    const rho = d === 1 ? 1 / k : 1 / (d * (d - 1));
    const tau = d < pivot ? r / (d * k) : d === pivot ? r * Math.log(r / 0.05) / k : 0;
    weights[Math.min(d, max) - 1] += rho + tau;
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  let cumulative = 0;
  for (let i = 0; i < max; i++) weights[i] = cumulative += weights[i] / sum;
  distributions.set(k, weights);
  if (distributions.size > 8) distributions.delete(distributions.keys().next().value);
  return weights;
}

export function frameIndices(seed, k) {
  if (seed < k) return [seed];
  if (k === 1) return [0];
  const rand = random(seed ^ Math.imul(k, 0x9e3779b1));
  let degree = 1;
  if ((seed - k) % 4 !== 0) {
    const value = rand();
    const cdf = degreeDistribution(k);
    while (degree < cdf.length && value > cdf[degree - 1]) degree++;
  }
  const indices = new Set();
  while (indices.size < degree) indices.add(Math.floor(rand() * k));
  return [...indices];
}

function xorInto(out, data) {
  for (let i = 0; i < out.length; i++) out[i] ^= data[i];
}

export class VisualEncoder {
  constructor(content, { blockBytes = 384, encrypted = false, id = crypto.getRandomValues(new Uint8Array(8)) } = {}) {
    if (!content.length || content.length > MAX_VISUAL_CONTENT) throw new RangeError('İçerik görsel aktarım için çok büyük veya boş.');
    if (!Number.isInteger(blockBytes) || blockBytes < 16 || blockBytes > MAX_BLOCK) throw new RangeError('Geçersiz parça boyu.');
    this.length = content.length;
    this.size = blockBytes;
    this.k = Math.ceil(content.length / blockBytes);
    if (this.k > 65535 || id.length !== 8) throw new RangeError('Geçersiz aktarım boyutu.');
    this.encrypted = encrypted;
    this.id = Uint8Array.from(id);
    this.checksum = crc32(content);
    this.data = new Uint8Array(this.k * blockBytes);
    this.data.set(content);
  }

  frame(seed) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Geçersiz kare sırası.');
    const out = new Uint8Array(HEADER + this.size + 4);
    const v = new DataView(out.buffer);
    out.set(MAGIC);
    out[5] = 1;
    out[6] = this.encrypted ? 1 : 0;
    out.set(this.id, 7);
    v.setUint32(15, this.length);
    v.setUint16(19, this.size);
    v.setUint16(21, this.k);
    v.setUint32(23, seed);
    v.setUint32(27, this.checksum);
    const payload = out.subarray(HEADER, HEADER + this.size);
    for (const i of frameIndices(seed, this.k)) xorInto(payload, this.data.subarray(i * this.size, (i + 1) * this.size));
    v.setUint32(out.length - 4, crc32(out.subarray(0, -4)));
    return out;
  }
}

/** İlgisiz QR, bozuk kare veya sınır dışı başlıkta null; bellek ayırmadan doğrula. */
export function parseVisualFrame(bytes) {
  if (bytes.length < HEADER + 20 || !MAGIC.every((b, i) => bytes[i] === b) || bytes[5] !== 1 || (bytes[6] & ~1)) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = v.getUint32(15);
  const size = v.getUint16(19);
  const k = v.getUint16(21);
  if (!length || length > MAX_VISUAL_CONTENT || size < 16 || size > MAX_BLOCK || k !== Math.ceil(length / size)) return null;
  if (bytes.length !== HEADER + size + 4 || v.getUint32(bytes.length - 4) !== crc32(bytes.subarray(0, -4))) return null;
  return {
    id: [...bytes.subarray(7, 15)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    length, size, k, seed: v.getUint32(23), checksum: v.getUint32(27),
    encrypted: !!bytes[6], data: bytes.subarray(HEADER, -4),
  };
}

export class VisualAssembler {
  constructor() {
    this.active = null;
  }

  add(bytes) {
    const frame = parseVisualFrame(bytes);
    if (!frame) return null;
    if (!this.active) {
      this.active = {
        ...frame, blocks: new Array(frame.k), links: new Array(frame.k),
        equations: new Set(), seen: new Set(), have: 0, done: false,
      };
    }
    const a = this.active;
    const status = () => ({ id: a.id, have: a.have, need: a.k, length: a.length, encrypted: a.encrypted, done: a.done });
    if (a.id !== frame.id || a.k !== frame.k || a.size !== frame.size || a.length !== frame.length || a.checksum !== frame.checksum || a.encrypted !== frame.encrypted) {
      return { ...status(), ignored: true };
    }
    if (a.done || a.seen.has(frame.seed)) return status();
    a.seen.add(frame.seed);
    if (a.seen.size > Math.max(256, 2 * a.k)) a.seen.delete(a.seen.values().next().value);
    const data = frame.data.slice();
    const unknown = new Set();
    for (const i of frameIndices(frame.seed, a.k)) {
      if (a.blocks[i]) xorInto(data, a.blocks[i]);
      else unknown.add(i);
    }
    const queue = [];
    if (unknown.size === 1) queue.push({ index: unknown.values().next().value, data });
    else if (unknown.size > 1) {
      const equation = { unknown, data };
      if (a.equations.size >= Math.min(32768, 2 * a.k)) this.removeEquation(a.equations.values().next().value);
      a.equations.add(equation);
      for (const i of unknown) (a.links[i] ??= new Set()).add(equation);
    }
    while (queue.length) {
      const solved = queue.pop();
      if (a.blocks[solved.index]) continue;
      a.blocks[solved.index] = solved.data;
      a.have++;
      for (const eq of [...(a.links[solved.index] ?? [])]) {
        eq.unknown.delete(solved.index);
        xorInto(eq.data, solved.data);
        if (eq.unknown.size <= 1) {
          this.removeEquation(eq);
          if (eq.unknown.size) queue.push({ index: eq.unknown.values().next().value, data: eq.data });
        }
      }
      a.links[solved.index] = undefined;
    }
    if (a.have !== a.k) return status();
    const content = new Uint8Array(a.length);
    for (let i = 0; i < a.k; i++) content.set(a.blocks[i].subarray(0, Math.min(a.size, a.length - i * a.size)), i * a.size);
    if (crc32(content) !== a.checksum) throw new Error('Aktarımın sağlaması tutmadı. Alımı sıfırlayıp yeniden deneyin.');
    a.done = true;
    a.blocks = [];
    a.links = [];
    a.equations.clear();
    a.seen.clear();
    return { ...status(), content };
  }

  removeEquation(eq) {
    this.active.equations.delete(eq);
    for (const i of eq.unknown) this.active.links[i]?.delete(eq);
  }
}
