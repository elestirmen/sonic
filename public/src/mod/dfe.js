// SC-DFE — tek taşıyıcılı koherent PSK ve uyarlamalı karar geri beslemeli eşitleyici (Mod 8).
//
// Su altı akustiğinde yüksek hızın klasik yolu (Stojanovic, Catipovic ve Proakis 1994): tek bir
// taşıyıcıda BPSK/QPSK, alıcıda yarım sembol aralıklı ileri besleme süzgeci (FF), geçmiş kararlardan
// beslenen geri besleme süzgeci (FB) ve ikinci dereceden sayısal faz kilitli döngü (DPLL). Üçü
// birlikte, ortalama kare hatayı en aza indirecek biçimde uyarlanır; süzgeç katsayıları üstel
// ağırlıklı RLS ile (Haykin 2002). Çok taşıyıcılı yöntemlerin (Mod 3, Mod 6) tersine koruma aralığı
// yoktur: oda yankısının yol açtığı semboller arası girişimi (ISI) eşitleyici öğrenip temizler.
//
// Verici: bant fLow–fHigh, RRC darbe (β = 0,5, bkz. dsp/pulse.js), sembol hızı Rs = B / (1 + β)
// (standart bantta 4000 sembol/sn). Sembol a_n birim genlikli BPSK ya da Gray kodlu QPSK'dir; ses
// s(t) = Re{Σ a_n p(t − nT) e^{j2πfc t}}. Paket: TRAIN bilinen eğitim sembolü, sonra veri. Veri
// BLOCK sembollük bloklara bölünür, aralarına PROBE bilinen "sonda" sembolü girer (MIL-STD-188-110
// tek tonlu dalga biçimindeki gibi): eşitleyici her blokta hatasız başvuru alır, karar hatalarının
// geri beslemede birbirini doğurması (hata yayılımı) bloğu aşmaz. Kodlu bitler serpiştirilir
// (satır-sütun, bkz. dsss.js) ve PRBS-15 ile beyazlatılır: tekdüze veri (boş görsel alanı) sabit bir
// sembol dizisi olup süzgecin uyarlanmasını durdurmasın.
//
// Alıcı, her sembol n için:
//   u_n   : uyumlu süzgeç çıkışı, sembol zamanının FF_PRE yarım sembol öncesinden başlayan FF örnek
//           (yarım sembol aralıklı, kesirli aralıklı eşitleyici; zamanlama fazına duyarsız)
//   v_n   = [u_n · e^{−jθ_n} ; d_{n−1} … d_{n−FB}],  z_n = c^H v_n = p_n + f_n (FF ve FB payları)
//   d_n   : eğitim ya da sondada bilinen sembol, veride z_n'nin en yakın takımyıldız noktası
//   e_n   = d_n − z_n;  RLS: k = P v / (λ + v^H P v),  c ← c + k e*,  P ← (P − k v^H P) / λ
//   DPLL  : Φ = Im{p_n (d_n − f_n)*},  θ ← θ + K1 Φ + ν,  ν ← ν + K2 Φ
// Seste taşıyıcı osilatörü yoktur: saat farkı, 44,1 ↔ 48 kHz ve hareket zamanı ölçekler, bu da
// temel bantta fc ile orantılı bir faz dönmesi olarak görünür (bkz. qam.js, dsss.js). DPLL'nin
// tümlevci durumu ν (sembol başı faz artışı) bu yüzden zaman ölçeğinin de ölçüsüdür: örnekleme anı
// her sembolde −ν / (2π fc) saniye kaydırılır. Kazanım: eğitim dizisiyle bir gecikme penceresinde
// ilinti; en güçlü tepenin −6 dB'lik payındaki ilk yol ana yoldur (ondan sonra gelenler FB'nin
// temizleyeceği son imleçler olsun), fazı θ'yı, iki yarısının faz farkı ν'yü başlatır. Sonra FF ana
// dokusu 1'le başlayan süzgeç eğitim dizisi boyunca RLS ile eğitilir.
//
// Yumuşak karar: z'nin eksenleri Gauss yaklaşımıyla LLR'ye çevrilir (2·a·x / σ²; σ², hata
// karesinin üstel ortalaması). Eşitleyici ISI'yi temizler ama FB'nin kapsamını (FB sembol) aşan
// geç yankı gürültü gibi kalır: oda yankısı RT60 0,5 s iken yankı enerjisinin yalnız ~%15'i ilk
// 6 ms'dedir. Bu yüzden Mod 6 gibi yakın mesafe içindir.
//
// Stojanovic vd. 1994'ten sapmalar:
//   1. Tek alıcı (çok kanallı uzamsal birleştirme yok); ses bandı, 3,7–4 kBd.
//   2. Eğitim yalnız başta değil, veri blokları arasında kısa sondalar var (MIL-STD-188-110).
//   3. Zaman ölçeği ayrı bir döngüyle değil, DPLL'nin frekans durumundan izlenir (osilatör yok).
//   4. Kararlar kod çözülmeden (sert) geri beslenir, dışta K = 7 evrişimli kod + RS; yumuşak
//      kararlı Viterbi. Turbo eşitleme (kod çözücüden eşitleyiciye geri besleme) yok.

import { headerCodedBits } from '../codec/framing.js';
import { RX_TABLE, TX_TABLE, TX_TAPS, rxKernel, txTable } from '../dsp/pulse.js';
import { interleaveOrder, spreadingCode } from './dsss.js';

const TWO_PI = 2 * Math.PI;
const ROLLOFF = 0.5;
const TRAIN = 128; // eğitim sembolü (4 kBd'de 32 ms); RLS ~2N sembolde yakınsar
const BLOCK = 96; // sondalar arası veri sembolü
const PROBE = 8; // sonda sembolü (hız payı %7,7)
const FF = 12; // ileri besleme dokusu (yarım sembol aralıklı: 6 sembol)
const FF_PRE = 3; // ana yoldan önceki FF dokusu
const FB = 24; // geri besleme dokusu (sembol; 4 kBd'de 6 ms yankı)
const LAMBDA = 0.998; // RLS unutma katsayısı: bellek ~500 sembol, ayar kaybı ~0,15 dB
const DELTA = 0.1; // RLS başlangıcı P = I / δ (girişler birim güce ölçeklidir)
const PLL_BW = 0.005; // DPLL gürültü bant genişliği × T (4 kBd'de 20 Hz)
const PLL_ZETA = 0.707;
const MAX_RATE = 6e-4; // en büyük zaman ölçeği farkı: 300 ppm saat farkı + ~10 cm/sn hareket
const PRE_WINDOW = 0.002; // kazanımda senkron zamanından önce aranan gecikme (s)
const POST_WINDOW = 0.006; // ve sonra (s)
const FIRST_PATH = 0.25; // ana yol: en güçlü tepenin bu güç oranındaki ilk tepe (−6 dB)
const NOISE_ALPHA = 0.02; // hata gücünün üstel ortalaması (sembol başı)
const CLIP = 1.6; // karmaşık zarf, RMS'in bu katında kırpılır (RRC β = 0,5 QPSK'de tepe ~1,8)
const RAMP = 0.001; // paketin başında ve sonunda yumuşak geçiş (s)
const R2 = Math.SQRT1_2;

const PN = spreadingCode('prbs15'); // ±1, periyot 32767
const PN_LEN = PN.length;
// PRBS-15'in başı, başlangıç durumundan (tek 1, on dört 0) uzun 0/1 dizileri taşır; eğitim dizisi
// oradan alınınca kısmi ilintisi −6 dB'lik yan tepeler yapıyordu. Bilinen semboller ve beyazlatma
// dizinin iyi karışmış, birbirinden uzak yerlerinden alınır.
const KNOWN_OFFSET = 1000;
const WHITEN_OFFSET = 17777;

/** Kodlu bit sırası k'deki beyazlatma biti. */
const whiten = (k) => (PN[(k + WHITEN_OFFSET) % PN_LEN] < 0 ? 1 : 0);

/** j. paket sembolü bilinen (eğitim ya da sonda) mu? */
function isKnown(j) {
  return j < TRAIN || (j - TRAIN) % (BLOCK + PROBE) >= BLOCK;
}

/** j. paket sembolünün bilinen değeri: BPSK'de ±1, QPSK'de (±1 ± j) / √2. */
function known(j, m) {
  const k = KNOWN_OFFSET + m * j;
  if (m === 1) return [PN[k % PN_LEN], 0];
  return [PN[k % PN_LEN] * R2, PN[(k + 1) % PN_LEN] * R2];
}

const infoCache = new WeakMap();

/** Profil bilgisi: { T, lo, hi, codedBitRate } ve iç ayrıntılar (sembol hızı, taşıyıcı, bit/sembol). */
export function dfeInfo(p) {
  let info = infoCache.get(p);
  if (!info) {
    const beta = p.rolloff ?? ROLLOFF;
    const Rs = (p.fHigh - p.fLow) / (1 + beta);
    const m = Math.log2(p.psk);
    if (m !== 1 && m !== 2) throw new RangeError(`dfe: desteklenmeyen PSK ${p.psk}`);
    info = {
      T: 1 / Rs,
      lo: p.fLow,
      hi: p.fHigh,
      codedBitRate: (m * Rs * BLOCK) / (BLOCK + PROBE),
      Rs,
      fc: (p.fLow + p.fHigh) / 2,
      beta,
      m,
    };
    infoCache.set(p, info);
  }
  return info;
}

/** Eğitim + veri + sondalar. */
export function dfeSymbolCount(p, headerBits, payloadBits) {
  const { m } = dfeInfo(p);
  const data = Math.ceil(headerBits / m) + Math.ceil(payloadBits / m);
  return TRAIN + data + (data > 0 ? Math.floor((data - 1) / BLOCK) * PROBE : 0);
}

/** Bir bölümün kodlu bitleri → semboller (serpiştirme, beyazlatma, eşleme). offset: bölümün ilk bitinin beyazlatma sırası. */
function mapPart(bits, m, offset) {
  const n = bits.length;
  const order = interleaveOrder(n);
  const S = Math.ceil(n / m);
  const re = new Float64Array(S);
  const im = new Float64Array(S);
  for (let s = 0; s < S; s++) {
    const b = [0, 0];
    for (let q = 0; q < m; q++) {
      const t = s * m + q;
      b[q] = (t < n ? bits[order[t]] : 0) ^ whiten(offset + t);
    }
    if (m === 1) re[s] = 1 - 2 * b[0];
    else {
      re[s] = (1 - 2 * b[0]) * R2;
      im[s] = (1 - 2 * b[1]) * R2;
    }
  }
  return { re, im };
}

/**
 * Sembolleri out'a ekler. start: ilk sembolün başı (kesirli örnek no); n. sembolün darbesi
 * start + (n + ½)·T'de ortalanır. headerBits / payloadBits: evrişimli kodlu bitler.
 */
export function renderDfe(out, start, headerBits, payloadBits, p, fs, amplitude) {
  const info = dfeInfo(p);
  const { m, Rs, fc, beta } = info;
  const head = mapPart(headerBits, m, 0);
  const body = mapPart(payloadBits, m, head.re.length * m);
  const count = dfeSymbolCount(p, headerBits.length, payloadBits.length);
  const sr = new Float64Array(count);
  const si = new Float64Array(count);
  for (let j = 0, k = 0; j < count; j++) {
    let v;
    if (isKnown(j)) v = known(j, m);
    else {
      const src = k < head.re.length ? head : body;
      const i = k < head.re.length ? k : k - head.re.length;
      v = [src.re[i], src.im[i]];
      k++;
    }
    sr[j] = v[0];
    si[j] = v[1];
  }
  const sps = fs / Rs;
  const table = txTable(beta);
  const lim = table.length - 1;
  const end = start + count * sps;
  const first = Math.max(0, Math.ceil(start));
  const last = Math.min(out.length - 1, Math.ceil(end) - 1);
  const rampN = RAMP * fs;
  const w = (TWO_PI * fc) / fs;
  const gain = amplitude / CLIP;
  for (let i = first; i <= last; i++) {
    const u = (i - start) / sps; // sembol cinsinden zaman
    const n0 = Math.max(0, Math.ceil(u - 0.5 - TX_TAPS));
    const n1 = Math.min(count - 1, Math.floor(u - 0.5 + TX_TAPS));
    let xr = 0;
    let xi = 0;
    for (let n = n0; n <= n1; n++) {
      const pos = (u - n - 0.5 + TX_TAPS) * TX_TABLE;
      const k = Math.floor(pos);
      if (k < 0 || k >= lim) continue; // kayan nokta: pencerenin tam ucu
      const h = table[k] + (pos - k) * (table[k + 1] - table[k]);
      xr += sr[n] * h;
      xi += si[n] * h;
    }
    const env = Math.hypot(xr, xi);
    if (env > CLIP) {
      xr *= CLIP / env;
      xi *= CLIP / env;
    }
    const edge = Math.min(i - start, end - i);
    const ramp = edge < rampN ? 0.5 - 0.5 * Math.cos((Math.PI * Math.max(0, edge)) / rampN) : 1;
    const ph = w * (i - start);
    out[i] += gain * ramp * (xr * Math.cos(ph) - xi * Math.sin(ph));
  }
  return last + 1;
}

/**
 * Tek paketin SC-DFE çözücüsü. read(j): eğitim ve sonda sembollerinde {} (uyarlama), veride
 * { soft: [LLR…], margin, snr }. Son eğitim sembolünde kazanım ve eğitim birlikte yapılır.
 */
export class DfeDemod {
  constructor(p, fs, start) {
    const info = dfeInfo(p);
    this.info = info;
    this.m = info.m;
    this.fs = fs;
    this.start = start;
    this.sps = fs / info.Rs;
    this.hs = this.sps / 2;
    this.kern = rxKernel(this.sps, info.beta);
    this.wc = (TWO_PI * info.fc) / fs; // örnek başı taşıyıcı açısı
    this.N = FF + FB;
    const N = this.N;
    this.cr = new Float64Array(N); // eşitleyici katsayıları (z = c^H v)
    this.ci = new Float64Array(N);
    this.vr = new Float64Array(N);
    this.vi = new Float64Array(N);
    this.Pr = new Float64Array(N * N);
    this.Pi = new Float64Array(N * N);
    this.pvr = new Float64Array(N);
    this.pvi = new Float64Array(N);
    this.ur = new Float64Array(FF);
    this.ui = new Float64Array(FF);
    this.pre = Math.round(PRE_WINDOW * info.Rs * 2); // kazanım penceresi, yarım sembol
    this.post = Math.round(POST_WINDOW * info.Rs * 2);
    this.offset = 0;
    this.scale = 1;
    this.theta = 0;
    this.nu = 0;
    this.nuMax = TWO_PI * info.fc * MAX_RATE * info.T;
    // İkinci dereceden döngü (Gardner): ζ, Bn·T → orantı ve tümlevci kazançları.
    const den = PLL_ZETA + 1 / (4 * PLL_ZETA);
    this.k1 = (4 * PLL_ZETA * PLL_BW) / den;
    this.k2 = (4 * PLL_BW * PLL_BW) / (den * den);
    this.mse = 1;
    this.mseRe = 0.5;
    this.headerSymbols = Math.ceil(headerCodedBits(p) / this.m);
    this.bitsPerSymbol = this.m;
  }

  /** n. sembolün ana yol zamanı (kesirli örnek no). */
  center(n) {
    return this.start + (n + 0.5) * this.sps + this.offset;
  }

  /** pos0'dan başlayan count yarım sembol aralıklı çıkış için okunacak bölge. */
  span(pos0, count) {
    const from = Math.floor(pos0 - this.kern.half) - 1;
    return { from, len: Math.ceil((count - 1) * this.hs) + 2 * this.kern.half + 4 };
  }

  windowEnd(j) {
    if (j < TRAIN - 1) return 0; // eğitim, son eğitim sembolünde topluca işlenir
    const extra = j === TRAIN - 1 ? this.post + 4 * 2 : 0; // kazanım penceresi + zamanlama payı
    const { from, len } = this.span(this.center(j) - FF_PRE * this.hs, FF + extra);
    return from + len;
  }

  /** Uyumlu süzgeç (RRC) çıkışları: pos0 + i·hs konumlarında, temel bantta (mutlak örneğe göre fazlı). */
  filter(store, pos0, count, outR, outI) {
    const { from, len } = this.span(pos0, count);
    if (!this.buf || this.buf.length < len) {
      this.buf = new Float32Array(len);
      this.yr = new Float64Array(len);
      this.yi = new Float64Array(len);
    }
    const buf = this.buf.subarray(0, len);
    if (!store.read(from, buf)) return false;
    const { yr, yi, hs } = this;
    let c = Math.cos(this.wc * from);
    let s = -Math.sin(this.wc * from);
    const dc = Math.cos(this.wc);
    const ds = -Math.sin(this.wc);
    for (let i = 0; i < len; i++) {
      yr[i] = buf[i] * c;
      yi[i] = buf[i] * s;
      const t = c * dc - s * ds;
      s = c * ds + s * dc;
      c = t;
    }
    const { half, taps, table, diff } = this.kern;
    for (let q = 0; q < count; q++) {
      const v = pos0 - from + q * hs - half;
      const i0 = Math.ceil(v);
      const x0 = Math.max(0, (i0 - v) * RX_TABLE);
      const k0 = Math.floor(x0);
      const fr = x0 - k0;
      let sr = 0;
      let si = 0;
      for (let t = 0, k = k0, i = i0; t < taps; t++, k += RX_TABLE, i++) {
        const h = table[k] + fr * diff[k];
        sr += yr[i] * h;
        si += yi[i] * h;
      }
      outR[q] = sr;
      outI[q] = si;
    }
    return true;
  }

  read(store, j) {
    if (j < TRAIN - 1) return {};
    if (j === TRAIN - 1) return this.acquire(store) ? {} : null;
    const r = this.step(store, j, isKnown(j));
    if (!r) return null;
    if (!r.data) return {};
    const { zr, zi } = r;
    const db = (x) => 10 * Math.log10(x);
    const snr = db(1 / Math.max(this.mse, 1e-6));
    if (this.m === 1) {
      const llr = (2 * zr) / Math.max(this.mseRe, 1e-6);
      return { soft: Float32Array.of(llr), margin: db(1 + Math.abs(llr)), snr };
    }
    const g = (2 * R2) / Math.max(this.mse / 2, 1e-6);
    const l0 = g * zr;
    const l1 = g * zi;
    return { soft: Float32Array.of(l0, l1), margin: db(1 + Math.min(Math.abs(l0), Math.abs(l1))), snr };
  }

  /**
   * Kazanım: eğitim dizisiyle yarım sembol adımlı gecikme penceresinde ilinti, ana yol (en güçlü
   * tepenin −6 dB'lik payındaki ilk tepe), faz ve sembol başı faz artışı; ardından eğitim.
   */
  acquire(store) {
    const { pre, post, m } = this;
    const lags = pre + post + 1;
    const count = 2 * (TRAIN - 1) + lags;
    const yr = new Float64Array(count);
    const yi = new Float64Array(count);
    if (!this.filter(store, this.center(0) - pre * this.hs, count, yr, yi)) return false;
    const half = TRAIN >> 1;
    const corr = (l, from, to) => {
      let ar = 0;
      let ai = 0;
      for (let n = from; n < to; n++) {
        const [kr, ki] = known(n, m);
        const i = 2 * n + l;
        ar += yr[i] * kr + yi[i] * ki; // y · conj(k)
        ai += yi[i] * kr - yr[i] * ki;
      }
      return [ar, ai];
    };
    const power = new Float64Array(lags);
    let top = 0;
    for (let l = 0; l < lags; l++) {
      const [ar, ai] = corr(l, 0, TRAIN);
      power[l] = ar * ar + ai * ai;
      if (power[l] > power[top]) top = l;
    }
    let main = top;
    for (let l = 0; l < top; l++) {
      const peak = (l === 0 || power[l] >= power[l - 1]) && power[l] >= power[l + 1];
      if (peak && power[l] >= FIRST_PATH * power[top]) {
        main = l;
        break;
      }
    }
    let frac = 0;
    if (main > 0 && main < lags - 1) {
      const a = Math.sqrt(power[main - 1]);
      const b = Math.sqrt(power[main]);
      const c = Math.sqrt(power[main + 1]);
      const den = a - 2 * b + c;
      if (den < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
    }
    const [c1r, c1i] = corr(main, 0, half);
    const [c2r, c2i] = corr(main, half, TRAIN);
    const [ar, ai] = [c1r + c2r, c1i + c2i];
    const g = Math.hypot(ar, ai) / TRAIN; // ana yolun uyumlu süzgeç çıkışındaki genliği
    if (!(g > 0)) return false;
    // iki yarının faz farkı → sembol başı faz artışı (yarılar arası half sembol)
    const dphi = Math.atan2(c2i * c1r - c2r * c1i, c2r * c1r + c2i * c1i);
    this.nu = Math.max(-this.nuMax, Math.min(this.nuMax, dphi / half));
    this.theta = Math.atan2(ai, ar) - (this.nu * (TRAIN - 1)) / 2; // ilintinin fazı dizinin ortasındadır
    this.offset += (main - pre + frac) * this.hs;
    this.scale = 1 / g;
    // FF ana dokusu 1, gerisi 0; P = I / δ.
    this.cr.fill(0);
    this.ci.fill(0);
    this.cr[FF_PRE] = 1;
    this.Pr.fill(0);
    this.Pi.fill(0);
    for (let i = 0; i < this.N; i++) this.Pr[i * this.N + i] = 1 / DELTA;
    this.vr.fill(0);
    this.vi.fill(0);
    let sum = 0;
    let sumRe = 0;
    for (let n = 0; n < TRAIN; n++) {
      const r = this.step(store, n, true);
      if (!r) return false;
      if (n >= half) {
        sum += r.er * r.er + r.ei * r.ei;
        sumRe += r.er * r.er;
      }
    }
    this.mse = Math.max(1e-4, sum / (TRAIN - half));
    this.mseRe = Math.max(5e-5, sumRe / (TRAIN - half));
    return true;
  }

  /** n. sembol: FF girişleri, eşitleyici çıkışı, karar, RLS, DPLL ve zamanlama. */
  step(store, n, isRef) {
    const { ur, ui, cr, ci, vr, vi, Pr, Pi, pvr, pvi, N, m } = this;
    if (!this.filter(store, this.center(n) - FF_PRE * this.hs, FF, ur, ui)) return null;
    // FB girişleri: geçmiş semboller, en yenisi başta (v[FF]); bir kaydır.
    for (let i = N - 1; i > FF; i--) {
      vr[i] = vr[i - 1];
      vi[i] = vi[i - 1];
    }
    if (n === 0) {
      vr[FF] = 0;
      vi[FF] = 0;
    } else {
      vr[FF] = this.lastR;
      vi[FF] = this.lastI;
    }
    const cth = Math.cos(this.theta) * this.scale;
    const sth = -Math.sin(this.theta) * this.scale;
    for (let i = 0; i < FF; i++) {
      vr[i] = ur[i] * cth - ui[i] * sth;
      vi[i] = ur[i] * sth + ui[i] * cth;
    }
    // z = c^H v; p: FF payı, f: FB payı
    let pr = 0;
    let pi = 0;
    let fr = 0;
    let fi = 0;
    for (let i = 0; i < N; i++) {
      const ar = cr[i] * vr[i] + ci[i] * vi[i];
      const ai = cr[i] * vi[i] - ci[i] * vr[i];
      if (i < FF) {
        pr += ar;
        pi += ai;
      } else {
        fr += ar;
        fi += ai;
      }
    }
    const zr = pr + fr;
    const zi = pi + fi;
    let dr;
    let di;
    if (isRef) [dr, di] = known(n, m);
    else if (m === 1) {
      dr = zr >= 0 ? 1 : -1;
      di = 0;
    } else {
      dr = zr >= 0 ? R2 : -R2;
      di = zi >= 0 ? R2 : -R2;
    }
    const er = dr - zr;
    const ei = di - zi;
    // RLS: pv = P v, k = pv / (λ + v^H pv), c += k e*, P = (P − k pv^H) / λ (Hermitsel)
    let den = LAMBDA;
    for (let i = 0; i < N; i++) {
      let sr = 0;
      let si = 0;
      const row = i * N;
      for (let k = 0; k < N; k++) {
        const a = Pr[row + k];
        const b = Pi[row + k];
        sr += a * vr[k] - b * vi[k];
        si += a * vi[k] + b * vr[k];
      }
      pvr[i] = sr;
      pvi[i] = si;
      den += vr[i] * sr + vi[i] * si;
    }
    if (!(den > 0) || !Number.isFinite(den)) return null;
    const inv = 1 / den;
    for (let i = 0; i < N; i++) {
      const kr = pvr[i] * inv;
      const ki = pvi[i] * inv;
      cr[i] += kr * er + ki * ei; // k · conj(e)
      ci[i] += ki * er - kr * ei;
    }
    const il = 1 / LAMBDA;
    for (let i = 0; i < N; i++) {
      const kr = pvr[i] * inv;
      const ki = pvi[i] * inv;
      for (let k = i; k < N; k++) {
        // P_ik − k_i · conj(pv_k)
        const a = (Pr[i * N + k] - (kr * pvr[k] + ki * pvi[k])) * il;
        const b = (Pi[i * N + k] - (ki * pvr[k] - kr * pvi[k])) * il;
        Pr[i * N + k] = a;
        Pi[i * N + k] = k === i ? 0 : b;
        Pr[k * N + i] = a;
        Pi[k * N + i] = k === i ? 0 : -b;
      }
    }
    // DPLL: Φ = Im{p · conj(d − f)}
    const qr = dr - fr;
    const qi = di - fi;
    const phi = Math.max(-1, Math.min(1, pi * qr - pr * qi));
    this.theta += this.k1 * phi + this.nu;
    this.nu = Math.max(-this.nuMax, Math.min(this.nuMax, this.nu + this.k2 * phi));
    // zaman ölçeği: faz sembol başı ν dönünce örnekleme anı −ν / (2π fc) s kayar
    this.offset -= this.nu / this.wc;
    this.lastR = dr;
    this.lastI = di;
    const e2 = er * er + ei * ei;
    this.mse += NOISE_ALPHA * (e2 - this.mse);
    this.mseRe += NOISE_ALPHA * (er * er - this.mseRe);
    return { zr, zi, er, ei, data: !isRef };
  }

  symbolsFor(bits) {
    return Math.ceil(bits / this.m);
  }

  /** Veri süresi: sondalar dahil. */
  payloadSeconds(symbols) {
    return symbols * (1 + PROBE / BLOCK) * this.info.T;
  }

  /** mapPart'ın tersi: beyazlatmayı geri al (işaret), dolgu bitini at, serpiştirmeyi çöz. */
  deinterleave(flat, n, part) {
    const offset = part === 'header' ? 0 : this.headerSymbols * this.m;
    const order = interleaveOrder(n);
    const out = new Float32Array(n);
    for (let t = 0; t < n; t++) {
      const l = flat[t] || 0;
      out[order[t]] = whiten(offset + t) ? -l : l;
    }
    return out;
  }
}
