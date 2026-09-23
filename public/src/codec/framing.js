// Paket çerçevesi: başlık ve veri baytları, CRC ve Reed-Solomon koruması.
//
//   başlık : [uzunluk (2), bayraklar] + 4 RS parite  → 7 bayt (en çok 2 hatayı düzeltir)
//   veri   : içerik + CRC-32, RS bloklarına bölünüp baytları iç içe dizilir
//
// Bayraklar: bit 7–6 sürüm, bit 5–2 profil no, bit 1 şifreli, bit 0 tür
// (0 metin, 1 nesne parçası: görsel/dosya, bkz. transfer.js).
// Alıcı; sürüm, profil ve uzunluğun profil sınırında olmasını kontrol ederek sahte senkronları eler.

import { crc32 } from './crc32.js';
import { rsEncode, rsDecode } from './reedsolomon.js';

export const VERSION = 2;
export const HEADER_PARITY = 4;
export const HEADER_BYTES = 3 + HEADER_PARITY;
export const HEADER_NIBBLES = HEADER_BYTES * 2;
export const KIND_TEXT = 0;
export const KIND_CHUNK = 1;
const CRC_BYTES = 4;
export const WEAK_DB = 3; // bu marjın altındaki semboller "şüpheli" sayılır

export function makeFlags(profileId, { encrypted = false, kind = KIND_TEXT } = {}) {
  return (VERSION << 6) | ((profileId & 15) << 2) | (encrypted ? 2 : 0) | (kind & 1);
}

export function parseFlags(flags) {
  return {
    version: flags >> 6,
    profileId: (flags >> 2) & 15,
    encrypted: (flags & 2) !== 0,
    kind: flags & 1,
  };
}

export function bytesToNibbles(bytes) {
  const out = new Uint8Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    out[2 * i] = bytes[i] >> 4;
    out[2 * i + 1] = bytes[i] & 15;
  }
  return out;
}

/** Nibble değerleri ve güvenleri (dB marj) → bayt dizisi ve bayt başına en kötü güven. */
export function nibblesToBytes(nibbles, nibbleConf, byteCount) {
  const bytes = new Uint8Array(byteCount);
  const conf = new Float32Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    bytes[i] = (nibbles[2 * i] << 4) | nibbles[2 * i + 1];
    conf[i] = nibbleConf ? Math.min(nibbleConf[2 * i], nibbleConf[2 * i + 1]) : Infinity;
  }
  return { bytes, conf };
}

export function encodeHeader(length, flags) {
  return rsEncode(Uint8Array.of(length >> 8, length & 255, flags), HEADER_PARITY);
}

/**
 * Başlığı çözer. Sahte senkronların geçmemesi için silinti denemesi en çok
 * 2 baytla sınırlı; böylece RS'nin hata yakalama payı kalır.
 */
export function decodeHeader(bytes, conf, profile) {
  const attempts = [[]];
  const weak = worstIndices(conf, 2, WEAK_DB);
  if (weak.length) attempts.push(weak);
  for (const erasures of attempts) {
    let res;
    try {
      res = rsDecode(bytes, HEADER_PARITY, erasures);
    } catch {
      continue;
    }
    const [hi, lo, flags] = res.data;
    const length = (hi << 8) | lo;
    const f = parseFlags(flags);
    if (f.version !== VERSION || f.profileId !== profile.id || length === 0 || length > profile.maxBytes) continue;
    return { length, encrypted: f.encrypted, kind: f.kind, corrected: res.corrected };
  }
  return null;
}

/** Mesaj uzunluğundan RS blok düzenini hesaplar (verici ve alıcı aynı sonucu bulur). */
export function payloadLayout(length, profile) {
  const dataLen = length + CRC_BYTES;
  const parity = Math.max(profile.fecMin, Math.ceil(dataLen * profile.fecRatio));
  const blockCount = Math.ceil((dataLen + parity) / 255);
  const blocks = [];
  for (let b = 0; b < blockCount; b++) {
    const k = Math.floor(dataLen / blockCount) + (b < dataLen % blockCount ? 1 : 0);
    const p = Math.floor(parity / blockCount) + (b < parity % blockCount ? 1 : 0);
    blocks.push({ k, p });
  }
  return { dataLen, parity, blocks, total: dataLen + parity };
}

export function encodePayload(message, profile) {
  const layout = payloadLayout(message.length, profile);
  const data = new Uint8Array(layout.dataLen);
  data.set(message);
  new DataView(data.buffer).setUint32(message.length, crc32(message));
  const blocks = [];
  let offset = 0;
  for (const { k, p } of layout.blocks) {
    blocks.push(rsEncode(data.subarray(offset, offset + k), p));
    offset += k;
  }
  return interleave(blocks);
}

/**
 * Veri bölümünü çözer. Her blok için önce silintisiz, sonra en şüpheli
 * baytları silinti sayarak denenir; CRC-32 tutan ilk birleşim kabul edilir.
 */
export function decodePayload(coded, conf, length, profile) {
  const layout = payloadLayout(length, profile);
  const lengths = layout.blocks.map((b) => b.k + b.p);
  const blockBytes = deinterleave(coded, lengths);
  const blockConf = deinterleave(conf, lengths);

  const candidates = layout.blocks.map(({ p }, b) => {
    const found = [];
    const seen = new Set();
    for (const erasures of erasureAttempts(blockConf[b], p)) {
      try {
        const res = rsDecode(blockBytes[b], p, erasures);
        const key = res.data.join(',');
        if (!seen.has(key)) {
          seen.add(key);
          found.push(res);
        }
      } catch {
        // bu deneme tutmadı, sıradakine geç
      }
    }
    return found;
  });
  if (candidates.some((c) => c.length === 0)) return { ok: false, reason: 'rs' };

  let tries = 0;
  for (const combo of cartesian(candidates)) {
    if (++tries > 256) break; // çok bloklu pakette birleşim sayısı patlamasın
    const data = new Uint8Array(layout.dataLen);
    let offset = 0;
    for (const res of combo) {
      data.set(res.data, offset);
      offset += res.data.length;
    }
    const message = data.slice(0, length);
    if (new DataView(data.buffer).getUint32(length) === crc32(message)) {
      return {
        ok: true,
        message,
        corrected: combo.reduce((s, r) => s + r.corrected, 0),
        erasures: combo.reduce((s, r) => s + r.erasures, 0),
      };
    }
  }
  return { ok: false, reason: 'crc' };
}

function erasureAttempts(conf, nsym) {
  const attempts = [[]];
  const push = (list) => {
    if (list.length && !attempts.some((a) => a.length === list.length && a.every((v, i) => v === list[i]))) {
      attempts.push(list);
    }
  };
  push(worstIndices(conf, nsym, WEAK_DB));
  push(worstIndices(conf, Math.floor(nsym / 2)));
  push(worstIndices(conf, nsym - 2));
  push(worstIndices(conf, nsym));
  return attempts;
}

/** Güveni en düşük (en çok count adet, isteğe bağlı eşik altındaki) indeksler. */
function worstIndices(conf, count, belowDb = Infinity) {
  if (!conf || count <= 0) return [];
  const idx = [];
  for (let i = 0; i < conf.length; i++) if (conf[i] < belowDb) idx.push(i);
  idx.sort((a, b) => conf[a] - conf[b]);
  return idx.slice(0, count).sort((a, b) => a - b);
}

function interleave(blocks) {
  const total = blocks.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  const maxLen = Math.max(...blocks.map((b) => b.length));
  let o = 0;
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.length) out[o++] = b[i];
  return out;
}

function deinterleave(data, lengths) {
  const blocks = lengths.map((n) => new data.constructor(n));
  const maxLen = Math.max(...lengths);
  let o = 0;
  for (let i = 0; i < maxLen; i++) {
    for (let b = 0; b < lengths.length; b++) if (i < lengths[b]) blocks[b][i] = data[o++];
  }
  return blocks;
}

function* cartesian(lists, prefix = []) {
  if (prefix.length === lists.length) {
    yield prefix;
    return;
  }
  for (const item of lists[prefix.length]) yield* cartesian(lists, [...prefix, item]);
}
