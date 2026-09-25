// Nesne aktarımı: görsel, dosya ya da tek pakete sığmayan uzun metin birden çok pakete
// bölünür ve paketler arası Reed-Solomon ile korunur. K veri parçasına M eşlik parçası
// eklenir; alıcı herhangi K farklı parçayı duyduğunda nesneyi kurar (duyulmayan
// paketler, yerleri bilindiği için silinti olarak düzeltilir). Gönderen akışı döngüde
// çalarsa eksik parçalar sonraki turlarda tamamlanır.
//
//   parça paketi (başlıkta tür = 1): [nesne no (2)] [K] [M] [sıra] + parça (C bayt)
//   nesne  : [içerik uzunluğu (4)] + içerik + sıfır dolgu (K·C'ye)
//   içerik : gövde ya da parolalıysa gövdenin AES-GCM kabı (bkz. crypto.js)
//   gövde  : [sürüm] [ad uzunluğu] [ad] [tür uzunluğu] [MIME türü] [veri] [CRC-32]
//
// Parçanın kendi CRC'si paket katmanında; gövdenin CRC'si yanlış birleştirmeyi yakalar.

import { crc32 } from './codec/crc32.js';
import { rsDecode, rsEncode } from './codec/reedsolomon.js';

export const CHUNK_HEADER = 5;
const BODY_VERSION = 1;
const MAX_CHUNKS = 255; // K + M, tek RS sözcüğü
export const TEXT_MIME = 'text/plain;charset=utf-8';

const utf8 = new TextEncoder();

/** Eşlik parçası sayısı: kayıpların ~%20'si tek turda kapansın; az parçada bir yedek yeter. */
export function parityCount(k) {
  return k <= 4 ? 1 : Math.max(2, Math.ceil(k * 0.2));
}

/** C bayt parçalarla taşınabilecek en büyük içerik. */
export function maxContentBytes(chunkBytes) {
  let k = MAX_CHUNKS - 1;
  while (k + parityCount(k) > MAX_CHUNKS) k--;
  return k * chunkBytes - 4;
}

/** Bir içeriğin C baytlık parçalarla kaç pakete bölüneceği. */
export function chunkPlan(contentBytes, chunkBytes) {
  const k = Math.ceil((contentBytes + 4) / chunkBytes);
  const m = parityCount(k);
  if (k + m > MAX_CHUNKS) throw new RangeError('içerik bu profil için fazla büyük');
  return { k, m, chunkBytes, packetBytes: CHUNK_HEADER + chunkBytes };
}

/**
 * Parça boyunu yayın süresine göre seçer: büyük parça paket başı sabit yükü (chirp,
 * başlık) azaltır, küçük parça dolguyu ve eşlik parçalarının payını. airtime(paket
 * boyu, paket sayısı) saniye döndürür; en çok maxChunk.
 */
export function planChunks(contentBytes, maxChunk, airtime) {
  let best = null;
  for (const div of [1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 8]) {
    const size = Math.max(16, Math.floor(maxChunk / div));
    let plan;
    try {
      plan = chunkPlan(contentBytes, size);
    } catch {
      continue;
    }
    const seconds = airtime(plan.packetBytes, plan.k + plan.m);
    if (!best || seconds < best.seconds - 1e-6) best = { ...plan, seconds };
  }
  if (!best) throw new RangeError('içerik bu profil için fazla büyük');
  return best;
}

function cut(bytes, max) {
  if (bytes.length <= max) return bytes;
  let n = max;
  while (n > 0 && (bytes[n] & 0xc0) === 0x80) n--; // UTF-8 karakterini ortadan bölme
  return bytes.subarray(0, n);
}

export function packBody({ name = '', mime = '', data }) {
  const n = cut(utf8.encode(name), 255);
  const t = cut(utf8.encode(mime), 255);
  const out = new Uint8Array(3 + n.length + t.length + data.length + 4);
  let o = 0;
  out[o++] = BODY_VERSION;
  out[o++] = n.length;
  out.set(n, o);
  o += n.length;
  out[o++] = t.length;
  out.set(t, o);
  o += t.length;
  out.set(data, o);
  o += data.length;
  new DataView(out.buffer).setUint32(o, crc32(out.subarray(0, o)));
  return out;
}

/** Gövdenin ad ve tür alanları; end'e kadar sığmıyorsa null. start: verinin başladığı yer. */
function readHead(body, end) {
  if (body.length < 3 || body[0] !== BODY_VERSION) return null;
  const dec = new TextDecoder();
  let o = 1;
  const n = body[o++];
  if (o + n >= end) return null;
  const name = dec.decode(body.subarray(o, o + n));
  o += n;
  const t = body[o++];
  if (o + t > end) return null;
  return { name, mime: dec.decode(body.subarray(o, o + t)), start: o + t };
}

/** Gövdeyi açar; bozuksa hata fırlatır. */
export function unpackBody(body) {
  if (body.length < 7 || body[0] !== BODY_VERSION) throw new Error('tanınmayan nesne biçimi');
  const end = body.length - 4;
  if (new DataView(body.buffer, body.byteOffset).getUint32(end) !== crc32(body.subarray(0, end))) {
    throw new Error('nesne sağlaması tutmuyor');
  }
  const head = readHead(body, end);
  if (!head) throw new Error('bozuk nesne');
  return { name: head.name, mime: head.mime, data: body.slice(head.start, end) };
}

/**
 * Nesnenin baştan gelmiş bölümünden (bkz. ObjectAssembler.prefix) adı, türü ve verinin
 * o ana kadarki kısmını okur; canlı önizleme içindir, sağlama henüz denetlenemez.
 * Başlık daha gelmediyse null.
 */
export function peekBody(prefix) {
  if (prefix.length < 7) return null;
  const length = new DataView(prefix.buffer, prefix.byteOffset).getUint32(0);
  const body = prefix.subarray(4, 4 + Math.min(length, prefix.length - 4));
  const end = length - 4; // CRC'den önce
  const head = readHead(body, Math.min(body.length, end));
  if (!head) return null;
  return { name: head.name, mime: head.mime, data: body.subarray(head.start, Math.min(body.length, end)), size: end - head.start };
}

/** İçeriği K veri + M eşlik parçasına böler; her biri bir paket gövdesi. */
export function makeChunks(content, chunkBytes, id) {
  const { k, m } = chunkPlan(content.length, chunkBytes);
  const object = new Uint8Array(k * chunkBytes);
  new DataView(object.buffer).setUint32(0, content.length);
  object.set(content, 4);
  const packets = [];
  for (let i = 0; i < k + m; i++) {
    const p = new Uint8Array(CHUNK_HEADER + chunkBytes);
    p[0] = id >> 8;
    p[1] = id & 255;
    p[2] = k;
    p[3] = m;
    p[4] = i;
    if (i < k) p.set(object.subarray(i * chunkBytes, (i + 1) * chunkBytes), CHUNK_HEADER);
    packets.push(p);
  }
  // Sütun sütun RS: her bayt konumu, K veri parçasının o baytlarından bir kod sözcüğüdür.
  const column = new Uint8Array(k);
  for (let c = 0; c < chunkBytes; c++) {
    for (let i = 0; i < k; i++) column[i] = object[i * chunkBytes + c];
    const code = rsEncode(column, m);
    for (let j = 0; j < m; j++) packets[k + j][CHUNK_HEADER + c] = code[k + j];
  }
  return packets;
}

export function parseChunk(packet) {
  if (packet.length <= CHUNK_HEADER) return null;
  const k = packet[2];
  const m = packet[3];
  const index = packet[4];
  if (k === 0 || k + m > MAX_CHUNKS || index >= k + m) return null;
  return { id: (packet[0] << 8) | packet[1], k, m, index, chunk: packet.subarray(CHUNK_HEADER) };
}

/** Parça paketlerini toplayıp nesneyi kurar. */
export class ObjectAssembler {
  constructor({ keep = 6 } = {}) {
    this.keep = keep;
    this.objects = new Map();
  }

  /**
   * Doğrulanmış (CRC'si tutan) bir parça paketini ekler. Döner:
   *   { id, have, need, total, done, fresh, content?, error? }  ya da geçersizse null.
   * fresh: bu çağrıda tamamlandı (content yalnız o zaman dolu).
   */
  add(packet, { encrypted = false, profile = '' } = {}) {
    const c = parseChunk(packet);
    if (!c) return null;
    let o = this.objects.get(c.id);
    if (!o || o.k !== c.k || o.m !== c.m || o.size !== c.chunk.length || o.encrypted !== encrypted) {
      o = { id: c.id, k: c.k, m: c.m, size: c.chunk.length, encrypted, profile, chunks: new Map(), done: false };
      this.objects.delete(c.id);
      this.objects.set(c.id, o);
      while (this.objects.size > this.keep) this.objects.delete(this.objects.keys().next().value);
    }
    if (!o.chunks.has(c.index)) o.chunks.set(c.index, c.chunk.slice());
    const status = { id: o.id, have: Math.min(o.chunks.size, o.k), need: o.k, total: o.k + o.m, done: o.done, fresh: false };
    if (o.done || o.chunks.size < o.k) return status;
    o.done = true;
    status.done = true;
    status.fresh = true;
    try {
      status.content = assemble(o);
    } catch (err) {
      status.error = err.message;
    }
    o.chunks.clear(); // bellek: tamamlanan nesnenin parçaları artık gerekmez
    return status;
  }

  /**
   * Henüz tamamlanmamış nesnelerin durumu (ilerleme göstergesi için).
   * head: baştan kesintisiz gelen veri parçası sayısı; have'den azsa arada eksik var.
   */
  pending() {
    return [...this.objects.values()]
      .filter((o) => !o.done)
      .map((o) => ({ id: o.id, have: o.chunks.size, need: o.k, total: o.k + o.m, head: headCount(o) }));
  }

  /**
   * Tamamlanmamış nesnenin baştan kesintisiz gelen baytları: parçalar sırayla gönderildiği
   * ve ilk K parça nesnenin kendisi olduğu için dosyanın başı nesne bitmeden okunabilir.
   * { bytes, encrypted } ya da henüz ilk parça yoksa null.
   */
  prefix(id) {
    const o = this.objects.get(id);
    if (!o || o.done) return null;
    const n = headCount(o);
    if (!n) return null;
    const bytes = new Uint8Array(n * o.size);
    for (let i = 0; i < n; i++) bytes.set(o.chunks.get(i), i * o.size);
    return { bytes, encrypted: o.encrypted };
  }
}

function headCount(o) {
  let n = 0;
  while (n < o.k && o.chunks.has(n)) n++;
  return n;
}

function assemble({ k, m, size, chunks }) {
  const object = new Uint8Array(k * size);
  const missing = [];
  for (let i = 0; i < k; i++) {
    const ch = chunks.get(i);
    if (ch) object.set(ch, i * size);
    else missing.push(i);
  }
  if (missing.length) {
    const erasures = [];
    for (let i = 0; i < k + m; i++) if (!chunks.has(i)) erasures.push(i);
    const word = new Uint8Array(k + m);
    for (let c = 0; c < size; c++) {
      for (let i = 0; i < k + m; i++) word[i] = chunks.get(i)?.[c] ?? 0;
      const { data } = rsDecode(word, m, erasures);
      for (const i of missing) object[i * size + c] = data[i];
    }
  }
  const length = new DataView(object.buffer).getUint32(0);
  if (length > object.length - 4) throw new Error('nesne uzunluğu geçersiz');
  return object.slice(4, 4 + length);
}
