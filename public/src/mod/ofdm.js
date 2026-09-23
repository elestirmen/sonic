// OFDM + diferansiyel PSK: kısa mesafede yüksek hız (Turbo ve Çok hızlı profilleri).
//
// Alt taşıyıcılar f = k·Δf (Δf = 1/Tu). Her sembol, koruma aralığı (döngüsel
// önek, CP) + Tu sürer; alıcı penceresi CP'nin ortasından başlar, böylece erken
// yansımalar ve küçük zaman kaymaları sembolü bozmaz. Bilgi, her taşıyıcının bir
// önceki kullanımına göre faz farkındadır (DQPSK: 2 bit, DBPSK: 1 bit);
// hoparlörün, mikrofonun ve odanın her frekanstaki kazanç ve faz etkisi farkta
// kendiliğinden düşer, kanal kestirimi gerekmez.
//
// Oda yankısı CP'den çok uzun sürer ve önceki sembolleri bugünkünün üstüne bindirir.
// hop > 1 ise taşıyıcılar bloklara bölünür, her sembolde tek blok çalar: bir blok
// hop sembol sonra yeniden kullanıldığında eski yankısı sönmüş olur (MFSK'deki ton
// kümeleri gibi). Hız hop'a bölünür, yankıya dayanıklılık belirgin artar.
//
// Seste taşıyıcı osilatörü yoktur: saat farkı ve cihaz hareketi yalnızca zamanı
// kaydırır. Bu, faz farkında frekansla orantılı bir eğim (−2π·f·τ) olarak görünür.
// τ, son hop sembolün (yani tüm bandın) fark vektörlerinden, verinin M. kuvvetiyle
// modülasyon silinerek, sıfırdan geçen doğruya en küçük karelerle bulunur; başlıkta
// önce bir ızgara taraması yapılır. Birikmiş kayma alıcı penceresini de taşır.
//
// Sembol sırası: hop referans (bilinen fazlar) · başlık (14 nibble, tüm taşıyıcılara
// döngüsel olarak tekrarlanır, dar bantta bloklar birkaç tur döner; alıcı kopyaları
// toplar) · veri.

import { ofdmInfo } from '../profiles.js';
import { HEADER_NIBBLES } from '../codec/framing.js';
import { BandPass } from '../dsp/filters.js';

const TWO_PI = 2 * Math.PI;
const GRAY_INV = [0, 1, 3, 2]; // 2 bitlik Gray kodu → faz indisi
const CREST = 2.3; // kırpma eşiği / RMS: bozulma ≈ −22 dB, ses gücü yüksek kalır
const WINDOW_POS = 0.5; // alıcı penceresi CP'nin bu oranı kadar içeriden başlar
const MAX_RATE = 6e-4; // en büyük gecikme değişim hızı: 300 ppm saat farkı + ~10 cm/sn hareket
const MAX_STEP = 0.25; // τ'nın sembolden sembole en çok, belirsizlik aralığının bu oranı kadar değişmesi

/** Referans + başlık + veri sembolleri. */
export function ofdmSymbolCount(p, payloadNibbles) {
  const { L, headerSymbols, nibbles } = ofdmInfo(p);
  return L + headerSymbols + Math.ceil(payloadNibbles / nibbles);
}

/** nibble dizisini taşıyıcı başına birimlere (DQPSK: 2 bit, DBPSK: 1 bit) açar. */
function toUnits(nibbles, from, count, bits, out) {
  const per = 4 / bits;
  const mask = (1 << bits) - 1;
  for (let q = 0; q < count; q++) {
    const v = from + q < nibbles.length ? nibbles[from + q] : 0;
    for (let u = 0; u < per; u++) out[q * per + u] = (v >> (4 - bits * (u + 1))) & mask;
  }
  return out;
}

/**
 * Veri bölümünü (ilk referanstan son veri sembolüne) out'a ekler. start: ilk
 * sembolün başladığı an (kesirli örnek no); fazlar gerçek zamana göre
 * hesaplanır, böylece her örnekleme hızında aynı sinyal çıkar.
 */
export function renderOfdm(out, start, headerNibbles, payloadNibbles, p, fs, amplitude) {
  const { freqs, Kb, L, order, bits, per, nibbles: Q, headerSymbols: H, Ts } = ofdmInfo(p);
  const M = p.psk;
  const nSym = ofdmSymbolCount(p, payloadNibbles.length);
  const S = Ts * fs;
  const C = p.cpDur * fs;
  const R = p.rollDur * fs;
  const first = Math.ceil(start - R / 2);
  const seg = new Float64Array(Math.floor(start + nSym * S + R / 2) - first + 1);
  const theta = new Float64Array(freqs.length);
  const units = new Uint8Array(Kb);
  const nUnits = HEADER_NIBBLES * per;
  const headerUnits = toUnits(headerNibbles, 0, HEADER_NIBBLES, bits, new Uint8Array(nUnits));

  for (let n = 0; n < nSym; n++) {
    const lo = order[n % L] * Kb;
    if (n < L) {
      for (let i = 0; i < Kb; i++) theta[lo + i] = (Math.PI * i * i) / Kb; // Newman fazları: tepe/RMS düşük
    } else {
      if (n < L + H) for (let i = 0; i < Kb; i++) units[i] = headerUnits[((n - L) * Kb + i) % nUnits];
      else toUnits(payloadNibbles, (n - L - H) * Q, Q, bits, units);
      for (let i = 0; i < Kb; i++) {
        const m = bits === 2 ? GRAY_INV[units[i]] : units[i];
        theta[lo + i] += ((2 * m + 1) * Math.PI) / M;
      }
    }
    // Sembol, iki yanda R/2 taşan yükseltilmiş kosinüs kenarlarla çizilir; komşuyla örtüşme
    // yalnız CP'nin başına düşer, alıcı penceresi oraya uzanmaz.
    const u = start + n * S;
    const ref = u + C; // faz başvurusu: yararlı bölümün başı
    const i0 = Math.ceil(u - R / 2);
    const i1 = Math.floor(u + S + R / 2);
    for (let k = lo; k < lo + Kb; k++) {
      const w = (TWO_PI * freqs[k]) / fs;
      const ph = w * (i0 - ref) + theta[k];
      let cr = Math.cos(ph);
      let ci = Math.sin(ph);
      const dr = Math.cos(w);
      const di = Math.sin(w);
      for (let i = i0, o = i0 - first; i <= i1; i++, o++) {
        const x = i - (u - R / 2);
        const y = u + S + R / 2 - i;
        const env = x < R ? 0.5 - 0.5 * Math.cos((Math.PI * x) / R) : y < R ? 0.5 - 0.5 * Math.cos((Math.PI * y) / R) : 1;
        seg[o] += env * cr;
        const t = cr * dr - ci * di;
        ci = cr * di + ci * dr;
        cr = t;
      }
    }
  }

  // Tepe/RMS sınırı: kırp, bant dışına taşan kırpma gürültüsünü süz, tepeyi genliğe ölçekle.
  let energy = 0;
  for (let i = 0; i < seg.length; i++) energy += seg[i] * seg[i];
  const clip = CREST * Math.sqrt(energy / seg.length);
  const bp = new BandPass(0.75 * p.fLow, 1.3 * p.fHigh, fs);
  let peak = 0;
  for (let i = 0; i < seg.length; i++) {
    seg[i] = bp.process(Math.max(-clip, Math.min(clip, seg[i])));
    peak = Math.max(peak, Math.abs(seg[i]));
  }
  const g = amplitude / (peak || 1);
  for (let i = 0; i < seg.length; i++) if (first + i >= 0 && first + i < out.length) out[first + i] += g * seg[i];
  return first + seg.length;
}

const tauCache = new WeakMap();

/**
 * τ arama aralığı: fiziksel sınır (MAX_RATE · hop · Ts) ile bandın belirsizliği.
 * Dar ve yüksek bir bantta (ultrasonik) M. kuvvet fazı 1/(M·f) aralıklarla neredeyse
 * aynı değeri verir; arama, ilk güçlü yan tepenin yarısında kesilir.
 */
function tauLimits(p) {
  let lim = tauCache.get(p);
  if (!lim) {
    const { freqs, L, Ts } = ofdmInfo(p);
    const M = p.psk;
    const fMax = freqs[freqs.length - 1];
    const step = 1 / (16 * M * fMax);
    const A = (d) => {
      let s = 0;
      for (const f of freqs) s += Math.cos(M * TWO_PI * f * d);
      return s / freqs.length;
    };
    let d = step;
    while (A(d) > 0.5) d += step; // ana tepe
    while (d < 5e-4 && A(d) < 0.5) d += step; // ilk güçlü yan tepe
    const ambiguity = d;
    lim = { range: Math.min(MAX_RATE * L * Ts, 0.5 * ambiguity), step, ambiguity };
    tauCache.set(p, lim);
  }
  return lim;
}

/**
 * Tek bir paketin alıcı tarafı. start: ilk sembolün başı (kesirli örnek no).
 * read(j) j. sembolün nibble'larını döndürür (referanslar ve son başlık sembolünden
 * öncekiler: boş, son başlık sembolü: 14, veri: Q).
 */
export class OfdmDemod {
  constructor(p, fs, start) {
    const info = ofdmInfo(p);
    this.p = p;
    this.fs = fs;
    this.info = info;
    this.lim = tauLimits(p);
    this.start = start;
    this.N = Math.round(info.Tu * fs);
    this.S = info.Ts * fs;
    this.offset = WINDOW_POS * p.cpDur * fs;
    this.payloadStart = HEADER_NIBBLES;
    const K = info.K;
    this.coef = new Float64Array(K);
    this.cw = new Float64Array(K);
    this.sw = new Float64Array(K);
    this.w = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      const w = (TWO_PI * info.freqs[k]) / fs;
      this.w[k] = w;
      this.cw[k] = Math.cos(w);
      this.sw[k] = Math.sin(w);
      this.coef[k] = 2 * Math.cos(w);
    }
    this.buf = new Float32Array(this.N);
    this.yr = new Float64Array(K);
    this.yi = new Float64Array(K);
    this.pr = new Float64Array(K); // taşıyıcının önceki kullanımı
    this.pi = new Float64Array(K);
    this.dr = new Float64Array(K); // taşıyıcının son fark vektörü
    this.di = new Float64Array(K);
    this.err = new Float64Array(K);
    this.idx = new Uint8Array(K);
    this.hdrR = new Float64Array(info.headerSymbols * info.Kb); // başlık sembollerinin fark vektörleri
    this.hdrI = new Float64Array(info.headerSymbols * info.Kb);
    this.noise = null; // taşıyıcı başına faz hatası varyansı (rad²)
    this.tau = 0; // hop sembollük gecikme artışı (s)
    this.drift = 0; // birikmiş gecikme (örnek)
  }

  windowStart(j) {
    return this.start + j * this.S + this.offset;
  }

  windowEnd(j) {
    return Math.round(this.windowStart(j) + this.drift) + this.N;
  }

  /** Goertzel ile bloktaki her taşıyıcının karmaşık genliği; faz, pencerenin nominal başına göre. */
  measure(store, j, lo, hi) {
    const w0 = this.windowStart(j);
    const s = Math.round(w0 + this.drift);
    if (!store.read(s, this.buf)) return false;
    const { buf, N, yr, yi } = this;
    const frac = w0 - s;
    for (let k = lo; k < hi; k++) {
      const c = this.coef[k];
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < N; i++) {
        const s0 = buf[i] + c * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      // X = e^{−jω(N−1)} (s1 − e^{−jω} s2), sonra nominal başa taşı: · e^{jω(w0 − s)}
      const xr = s1 - this.cw[k] * s2;
      const xi = this.sw[k] * s2;
      const a = this.w[k] * (frac - (N - 1));
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      yr[k] = xr * ca - xi * sa;
      yi[k] = xr * sa + xi * ca;
    }
    return true;
  }

  read(store, j) {
    const { Kb, L, order } = this.info;
    const lo = order[j % L] * Kb;
    const hi = lo + Kb;
    if (!this.measure(store, j, lo, hi)) return null;
    const { yr, yi, pr, pi, dr, di } = this;
    for (let k = lo; k < hi; k++) {
      if (j >= L) {
        dr[k] = yr[k] * pr[k] + yi[k] * pi[k];
        di[k] = yi[k] * pr[k] - yr[k] * pi[k];
      }
      pr[k] = yr[k];
      pi[k] = yi[k];
    }
    if (j < L) return EMPTY;
    const H = this.info.headerSymbols;
    if (j < L + H) {
      this.hdrR.set(dr.subarray(lo, hi), (j - L) * Kb);
      this.hdrI.set(di.subarray(lo, hi), (j - L) * Kb);
      if (j < L + H - 1) return EMPTY;
      this.tau = this.acquire();
      this.drift = ((L + H) / L) * this.tau * this.fs; // başlık boyunca birikmiş kayma
      return this.header();
    }
    this.tau = this.track();
    this.drift += (this.tau / L) * this.fs;
    this.decide(lo, hi);
    return this.payload(lo, hi);
  }

  /** τ düzeltmesiyle her taşıyıcının karar noktası ve faz hatası. */
  decide(lo, hi) {
    const M = this.p.psk;
    const step = TWO_PI / M;
    const f = this.info.freqs;
    for (let k = lo; k < hi; k++) {
      const a = Math.atan2(this.di[k], this.dr[k]) + TWO_PI * f[k] * this.tau;
      const m = Math.round((a - Math.PI / M) / step);
      this.err[k] = wrap(a - (2 * m + 1) * (Math.PI / M));
      this.idx[k] = ((m % M) + M) % M;
    }
  }

  /** Tüm taşıyıcılarda M. kuvvet uyumu: Σ |d| cos(M·(arg d + 2πfτ) − π). */
  score(tau) {
    const M = this.p.psk;
    const f = this.info.freqs;
    let s = 0;
    for (let k = 0; k < f.length; k++) {
      const amp = Math.hypot(this.dr[k], this.di[k]);
      s += amp * Math.cos(M * (Math.atan2(this.di[k], this.dr[k]) + TWO_PI * f[k] * tau) - Math.PI);
    }
    return s;
  }

  /** Başlıkta: ızgara taraması, sonra en küçük kareler. */
  acquire() {
    const { range, step } = this.lim;
    let best = 0;
    let bestScore = -Infinity;
    for (let t = -range; t <= range; t += step) {
      const s = this.score(t);
      if (s > bestScore) {
        bestScore = s;
        best = t;
      }
    }
    return this.refine(best);
  }

  /** Veride: bir önceki kestirimden başlayıp tüm bandın son fark vektörleriyle güncelle. */
  track() {
    const limit = MAX_STEP * this.lim.ambiguity;
    const t = this.refine(this.tau);
    return this.tau + Math.max(-limit, Math.min(limit, t - this.tau));
  }

  /** M. kuvvet artıkları üzerinden sıfırdan geçen doğruya ağırlıklı en küçük kareler. */
  refine(tau) {
    const M = this.p.psk;
    const f = this.info.freqs;
    const { dr, di } = this;
    for (let iter = 0; iter < 3; iter++) {
      let num = 0;
      let den = 0;
      for (let k = 0; k < f.length; k++) {
        const amp = Math.hypot(dr[k], di[k]);
        if (amp === 0) continue;
        const r = wrap(M * (Math.atan2(di[k], dr[k]) + TWO_PI * f[k] * tau) - Math.PI) / M; // ≈ −2π f δ
        num += amp * f[k] * r;
        den += amp * f[k] * f[k];
      }
      if (den === 0) break;
      tau -= num / (TWO_PI * den);
    }
    return tau;
  }

  /** Başlık: aynı birimin kopyaları (τ düzeltilmiş fark vektörleri) toplanıp karar verilir. */
  header() {
    const { K, Kb, L, order, bits, per, freqs, headerSymbols: H } = this.info;
    const M = this.p.psk;
    const nUnits = HEADER_NIBBLES * per;
    const sr = new Float64Array(nUnits);
    const si = new Float64Array(nUnits);
    const count = new Uint16Array(nUnits);
    const angle = new Float64Array(H * Kb);
    for (let h = 0; h < H; h++) {
      const lo = order[h % L] * Kb;
      for (let i = 0; i < Kb; i++) {
        const o = h * Kb + i;
        const a = Math.atan2(this.hdrI[o], this.hdrR[o]) + TWO_PI * freqs[lo + i] * this.tau;
        const amp = Math.hypot(this.hdrR[o], this.hdrI[o]);
        const u = o % nUnits;
        angle[o] = a;
        sr[u] += amp * Math.cos(a);
        si[u] += amp * Math.sin(a);
        count[u]++;
      }
    }
    const step = TWO_PI / M;
    const unitIdx = new Uint8Array(nUnits);
    const unitErr = new Float64Array(nUnits);
    for (let u = 0; u < nUnits; u++) {
      const a = Math.atan2(si[u], sr[u]);
      const m = Math.round((a - Math.PI / M) / step);
      unitErr[u] = wrap(a - (2 * m + 1) * (Math.PI / M));
      unitIdx[u] = ((m % M) + M) % M;
    }
    // Her taşıyıcının birleşik karara göre hatası: taşıyıcı gürültüsünün ilk kestirimi.
    this.noise = new Float64Array(K);
    const uses = new Uint16Array(K);
    let mean = 0;
    for (let h = 0; h < H; h++) {
      const lo = order[h % L] * Kb;
      for (let i = 0; i < Kb; i++) {
        const o = h * Kb + i;
        const e = wrap(angle[o] - (2 * unitIdx[o % nUnits] + 1) * (Math.PI / M));
        this.noise[lo + i] += e * e;
        uses[lo + i]++;
        mean += e * e;
      }
    }
    mean /= H * Kb;
    for (let k = 0; k < K; k++) this.noise[k] = 0.5 * (this.noise[k] / uses[k]) + 0.5 * mean + 1e-4;
    const values = new Array(HEADER_NIBBLES);
    const margins = new Array(HEADER_NIBBLES);
    const snrs = new Array(HEADER_NIBBLES);
    for (let q = 0; q < HEADER_NIBBLES; q++) {
      let v = 0;
      let worst = Infinity;
      for (let t = 0; t < per; t++) {
        const u = q * per + t;
        v = (v << bits) | gray(unitIdx[u], bits);
        const mu = Math.PI / M - Math.abs(unitErr[u]);
        worst = Math.min(worst, 10 * Math.log10(1 + (mu * mu * count[u]) / (mean + 1e-4)));
      }
      values[q] = v;
      margins[q] = worst;
      snrs[q] = -10 * Math.log10(mean + 1e-4);
    }
    return { values, margins, snrs };
  }

  payload(lo, hi) {
    const { per, bits } = this.info;
    const M = this.p.psk;
    const Q = (hi - lo) / per;
    const values = new Array(Q);
    const margins = new Array(Q);
    const snrs = new Array(Q);
    for (let q = 0; q < Q; q++) {
      let v = 0;
      let worst = Infinity;
      let snr = 0;
      for (let t = 0; t < per; t++) {
        const k = lo + q * per + t;
        v = (v << bits) | gray(this.idx[k], bits);
        const e = this.err[k];
        const mu = Math.PI / M - Math.abs(e);
        worst = Math.min(worst, 10 * Math.log10(1 + (mu * mu) / this.noise[k]));
        snr += -10 * Math.log10(this.noise[k]);
        this.noise[k] = 0.8 * this.noise[k] + 0.2 * e * e + 1e-5;
      }
      values[q] = v;
      margins[q] = worst;
      snrs[q] = snr / per;
    }
    return { values, margins, snrs };
  }
}

const EMPTY = { values: [], margins: [], snrs: [] };

function gray(m, bits) {
  return bits === 2 ? m ^ (m >> 1) : m;
}

function wrap(a) {
  return a - TWO_PI * Math.round(a / TWO_PI);
}
