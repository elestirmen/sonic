// Evrişimli kod ve yumuşak kararlı Viterbi çözücü.
//
// K = 7, oran 1/2, üreteçler 171 ve 133 (sekizlik): NASA/CCSDS ve IEEE 802.11'in
// standart kodu (serbest uzaklık 10). Dıştaki Reed-Solomon ile birlikte "birleştirilmiş
// kod" oluşturur (Forney 1966; CCSDS 131.0-B): Viterbi, kanalın yumuşak ölçümlerinden
// (LLR) yararlanıp hataların çoğunu düzeltir, geriye kalan kısa hata demetlerini RS temizler.
//
// LLR kuralı: log P(bit = 0) / P(bit = 1); pozitif değer 0'a, negatif 1'e işaret eder.
// Kodlayıcı her paketin sonunda K − 1 sıfırla sıfır durumuna döner (kuyruk bitleri).

export const CONSTRAINT = 7;
const TAIL = CONSTRAINT - 1;
const STATES = 1 << TAIL;
const G0 = 0o171;
const G1 = 0o133;

// OUT[r]: 7 bitlik kaydedici (en yeni bit en üstte) için iki çıkış biti (c0 << 1 | c1).
const OUT = new Uint8Array(1 << CONSTRAINT);
for (let r = 0; r < OUT.length; r++) OUT[r] = (parity(r & G0) << 1) | parity(r & G1);

function parity(x) {
  let p = 0;
  for (; x; x &= x - 1) p ^= 1;
  return p;
}

/** k bilgi biti → 2·(k + 6) kodlu bit. */
export const codedLength = (k) => 2 * (k + TAIL);

export function convEncode(bits) {
  const n = bits.length + TAIL;
  const out = new Uint8Array(2 * n);
  let state = 0;
  for (let t = 0; t < n; t++) {
    const r = ((t < bits.length ? bits[t] : 0) << TAIL) | state;
    out[2 * t] = OUT[r] >> 1;
    out[2 * t + 1] = OUT[r] & 1;
    state = r >> 1;
  }
  return out;
}

/** Yumuşak girişli Viterbi (en büyük olabilirlik yolu). llr: codedLength(k) değer. */
export function viterbiDecode(llr, k) {
  const T = k + TAIL;
  let pm = new Float64Array(STATES).fill(-Infinity);
  let next = new Float64Array(STATES);
  pm[0] = 0;
  const dec = new Uint8Array(T * STATES);
  for (let t = 0; t < T; t++) {
    const l0 = llr[2 * t] || 0;
    const l1 = llr[2 * t + 1] || 0;
    for (let ns = 0; ns < STATES; ns++) {
      const b = ns >> (TAIL - 1); // bu adımın giriş biti, yeni durumun en üst biti
      const base = (ns << 1) & (STATES - 1);
      const o0 = OUT[(b << TAIL) | base];
      const o1 = OUT[(b << TAIL) | base | 1];
      const m0 = pm[base] + (o0 & 2 ? -l0 : l0) + (o0 & 1 ? -l1 : l1);
      const m1 = pm[base | 1] + (o1 & 2 ? -l0 : l0) + (o1 & 1 ? -l1 : l1);
      if (m1 > m0) {
        next[ns] = m1;
        dec[t * STATES + ns] = 1;
      } else {
        next[ns] = m0;
      }
    }
    const tmp = pm;
    pm = next;
    next = tmp;
  }
  const out = new Uint8Array(k);
  let s = 0; // kuyruk bitleri sayesinde yol sıfır durumunda biter
  for (let t = T - 1; t >= 0; t--) {
    if (t < k) out[t] = s >> (TAIL - 1);
    s = ((s << 1) & (STATES - 1)) | dec[t * STATES + s];
  }
  return out;
}

/**
 * Çözülen bitleri yeniden kodlayıp kanal ölçümleriyle karşılaştırır: işareti tutmayan
 * kodlu bitlerin |LLR| toplamı, o bölgedeki bilgi bitlerinin ne kadar şüpheli olduğunu
 * gösterir. Bayt başına güven (dB benzeri; yüksek = güvenilir) döndürür; RS silintileri için.
 */
export function byteReliability(bits, llr) {
  const coded = convEncode(bits);
  const bad = new Float64Array(bits.length);
  for (let i = 0; i < coded.length; i++) {
    const l = llr[i] || 0;
    if ((l >= 0 ? 0 : 1) === coded[i]) continue;
    // i. kodlu bit, son K bilgi bitine bağlı
    const t = i >> 1;
    for (let j = Math.max(0, t - TAIL); j <= t && j < bits.length; j++) bad[j] += Math.abs(l);
  }
  const bytes = Math.floor(bits.length / 8);
  const conf = new Float32Array(bytes);
  for (let i = 0; i < bytes; i++) {
    let s = 0;
    for (let b = 0; b < 8; b++) s += bad[8 * i + b];
    conf[i] = 20 - 10 * Math.log10(1 + s);
  }
  return conf;
}

/**
 * Satır-sütun serpiştirme: rows bitlik sembollerle, j. sembolün b. biti kodlu dizinin
 * (b · cols + j). bitidir. Kodlu dizide yan yana duran bitler farklı sembollere düşer;
 * bozulan bir sembol, Viterbi'ye dağınık ve tek tük hatalar olarak ulaşır.
 */
export function interleave(bits, rows) {
  const cols = Math.ceil(bits.length / rows);
  const out = new Uint8Array(rows * cols);
  for (let b = 0; b < rows; b++) {
    for (let j = 0; j < cols; j++) {
      const i = b * cols + j;
      if (i < bits.length) out[j * rows + b] = bits[i];
    }
  }
  return out;
}

export function deinterleave(values, rows, n) {
  const cols = Math.ceil(n / rows);
  const out = new Float32Array(n);
  for (let b = 0; b < rows; b++) {
    for (let j = 0; j < cols; j++) {
      const i = b * cols + j;
      if (i < n) out[i] = values[j * rows + b] || 0;
    }
  }
  return out;
}

export function bytesToBits(bytes) {
  const out = new Uint8Array(bytes.length * 8);
  for (let i = 0; i < bytes.length; i++) for (let b = 0; b < 8; b++) out[8 * i + b] = (bytes[i] >> (7 - b)) & 1;
  return out;
}

export function bitsToBytes(bits) {
  const out = new Uint8Array(bits.length >> 3);
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | bits[8 * i + b];
    out[i] = v;
  }
  return out;
}
