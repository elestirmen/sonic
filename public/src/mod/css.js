// CSS — LoRa tipi chirp yayılı spektrum (Vangelista 2017, "Frequency Shift Chirp Modulation").
//
// Her sembol, fLow–fHigh bandını T = 2^SF / B sürede tarayan bir yukarı chirp'tir; bilgi
// chirp'in başlangıç frekansının döngüsel kaymasındadır (M = 2^SF kayma → SF bit). Alıcı
// sembolü temel banda indirip çip hızında (B) örnekler ve temel aşağı chirp'le çarpar
// ("dechirp"): kayma s, M noktalı FFT'nin s. kutusunda tek bir tepeye dönüşür. Sembolün
// enerjisi tek kutuda toplanırken gürültü ve dağınık oda yankısı M kutuya yayılır (işlem
// kazancı M; SF 8'de 24 dB). Yankının gecikmiş kopyaları başka kutulara düşer; hareket ve
// saat farkı ise kutunun küçük bir kesrine denk gelir ve her sembolde izlenir. Sabit
// zarflı olduğundan hoparlör sonuna kadar sürülebilir, kırpılmaya dayanıklıdır.
//
// Sembol değerleri Gray kodludur (komşu kutuya kayma tek bit hatası verir); bitler
// evrişimli kod + serpiştirme ile korunur, alıcı her bit için kutu genliklerinden LLR üretir.
//
// Paket: 3 başvuru sembolü (s = M/2: sarma ortada, zaman kayması ve saat farkının hızı
// en başta ölçülür) · başlık · veri. Başlık ve veri ayrı ayrı serpiştirilir.

import { FFT } from '../dsp/fft.js';
import { interleave } from '../codec/conv.js';

const TWO_PI = 2 * Math.PI;
const REF_SYMBOLS = 3;
const RAMP = 0.002; // paketin başında ve sonunda tık sesi olmasın (s)
const MAX_RATE = 6e-4; // en büyük gecikme değişim hızı: 300 ppm saat farkı + ~10 cm/sn hareket
const SYNC_VAR = 0.25 ** 2; // senkronun ilk zaman belirsizliği (çip²)
const RATE_VAR = 0.1 ** 2; // başlangıç kayma hızının öncül belirsizliği ((çip/sembol)²)
const MAX_CFO = 1.5; // izlenen Doppler sınırı (kutu): ultrasonikte 10 cm/sn ≈ yarım kutu
const RELIABLE_DB = 15; // bu kutu başı SNR'nin üstünde başvurular hız/Doppler başlatmaya yeter
// İzleyicinin beklediği sembol başı zaman değişimi (çip²): el titremesi, yaklaşma, saat farkı.
// Daha büyüğü güçlü sallamayı izler ama −15 dB SNR'de gürültüyü döngüye sokar (simülasyonda
// SF 7–8 için dengeli değer).
const TRACK_VAR = 5e-4;
const GATE = 0.45; // bu kadar (çip) büyük τ, üst üste gelmedikçe yanlış karar sayılıp atlanır
const TAPS = 8; // temel banda indirmede ara değerleme çekirdeğinin yarı genişliği (çip)
const CUTOFF = 0.55; // süzgeç kesimi (B cinsinden): bant kenarları düz geçsin, dışı az katlansın
const TABLE = 64; // çekirdek tablosunun örnek başına çözünürlüğü

export function cssInfo(p) {
  const M = 1 << p.sf;
  const B = p.fHigh - p.fLow;
  return { M, B, T: M / B, fc: (p.fLow + p.fHigh) / 2, bits: p.sf };
}

export const cssSymbols = (p, codedBits) => Math.ceil(codedBits / p.sf);

export function cssSymbolCount(p, headerBits, payloadBits) {
  return REF_SYMBOLS + cssSymbols(p, headerBits) + cssSymbols(p, payloadBits);
}

const gray = (k) => k ^ (k >> 1);
function grayInverse(v) {
  let k = v;
  for (let s = v >> 1; s; s >>= 1) k ^= s;
  return k;
}

/** Serpiştirilmiş kodlu bitler → sembol kaymaları (her sembol SF bit, en anlamlı bit önce). */
function toShifts(bits, sf) {
  const il = interleave(bits, sf);
  const out = [];
  for (let j = 0; j < il.length / sf; j++) {
    let v = 0;
    for (let b = 0; b < sf; b++) v = (v << 1) | il[j * sf + b];
    out.push(grayInverse(v));
  }
  return out;
}

/**
 * Veri bölümünü out'a ekler. start: ilk başvuru sembolünün başı (kesirli örnek no).
 * headerBits / payloadBits: evrişimli kodlu (serpiştirilmemiş) bitler.
 */
export function renderCss(out, start, headerBits, payloadBits, p, fs, amplitude) {
  const { M, B, T, fc } = cssInfo(p);
  const shifts = [...new Array(REF_SYMBOLS).fill(M / 2), ...toShifts(headerBits, p.sf), ...toShifts(payloadBits, p.sf)];
  const first = Math.ceil(start);
  const last = Math.floor(start + shifts.length * T * fs);
  const rampN = RAMP * fs;
  // Faz kapalı biçimde hesaplanır: sarma anı örnekler arasına düşse de sinyal, sürekli
  // zamandaki chirp'in tam örneklenmişidir (birikimli toplam bu anı yarım örnek kaydırır).
  let theta = 0; // sembol başındaki temel bant fazı; semboller arası faz süreklidir
  let j = -1;
  let w = 0;
  let tw = 0;
  for (let i = first; i <= last && i < out.length; i++) {
    const t = (i - start) / fs;
    const jj = Math.min(shifts.length - 1, Math.floor(t / T));
    while (j < jj) {
      if (j >= 0) theta += basePhase(T, B, w, tw, T);
      j++;
      w = shifts[j] / M;
      tw = (1 - w) * T;
    }
    const phase = TWO_PI * fc * t + theta + basePhase(T, B, w, tw, t - j * T);
    const edge = Math.min(i - start, last - i);
    const env = edge < rampN ? 0.5 - 0.5 * Math.cos((Math.PI * Math.max(0, edge)) / rampN) : 1;
    if (i >= 0) out[i] += amplitude * env * Math.cos(phase);
  }
  return last + 1;
}

/** Kaymalı chirp'in sembol başından τ anına temel bant fazı (tw: sarma anı). */
function basePhase(T, B, w, tw, tau) {
  const phase = TWO_PI * B * ((w - 0.5) * tau + (tau * tau) / (2 * T));
  return tau > tw ? phase - TWO_PI * B * (tau - tw) : phase;
}

const kernels = new Map();

/** Temel banda indirme çekirdeği: kesimi CUTOFF·B olan, Hann pencereli sinc (örnek cinsinden tablo). */
function kernel(fsB) {
  const key = fsB.toFixed(6);
  let k = kernels.get(key);
  if (!k) {
    const half = Math.ceil(TAPS * fsB);
    const table = new Float64Array(2 * half * TABLE + 2);
    for (let i = 0; i < table.length; i++) {
      const x = i / TABLE - half; // örnek cinsinden uzaklık
      const c = x / fsB; // çip cinsinden
      const a = 2 * CUTOFF * c;
      const sinc = a === 0 ? 1 : Math.sin(Math.PI * a) / (Math.PI * a);
      const w = Math.abs(c) >= TAPS ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * c) / TAPS);
      table[i] = (2 * CUTOFF * sinc * w) / fsB;
    }
    k = { half, table };
    kernels.set(key, k);
  }
  return k;
}

/**
 * Tek paketin CSS çözücüsü. read(j): başvuru sembollerinde zamanlamayı inceltir,
 * diğerlerinde SF bitin LLR'lerini döndürür ({ soft, snr, margin }).
 *
 * Zaman ve frekans izleme: chirp'te zaman kayması τ (çip) ile frekans kayması ε (kutu,
 * Doppler) birbirine karışır; ikisi de dechirp tonunu ε − τ kadar kaydırır. Onları ayıran,
 * chirp'in sarma anındaki faz sıçramasıdır: sarmadan sonraki kesim 2πτ ek faz taşır, ε ise
 * sıçrama yaratmaz. Karar verilen kutunun iki kesiminin (sarma öncesi/sonrası) tutarlı
 * toplamlarından önce ton frekansı (ε − τ), sonra aradaki faz farkından τ bulunur. Tutarlı
 * toplamlar yalnız doğrudan yolun frekansında alındığından oda yankısı (başka kutulara düşen
 * gecikmiş kopyalar) kestirimi saptırmaz. τ ikinci dereceden bir döngüyle zamanlamayı, ε
 * ise sonraki sembollerin dechirp'ini düzeltir.
 */
export class CssDemod {
  constructor(p, fs, start) {
    const info = cssInfo(p);
    this.p = p;
    this.info = info;
    this.fs = fs;
    this.start = start;
    this.fsB = fs / info.B; // çip başına örnek
    this.symN = info.T * fs;
    this.kern = kernel(this.fsB);
    this.wc = (TWO_PI * info.fc) / fs;
    const M = info.M;
    this.fft = new FFT(M);
    this.cr = new Float64Array(M); // temel yukarı chirp'in eşleniği
    this.ci = new Float64Array(M);
    for (let m = 0; m < M; m++) {
      const a = -Math.PI * ((m * m) / M - m);
      this.cr[m] = Math.cos(a);
      this.ci[m] = Math.sin(a);
    }
    this.re = new Float64Array(M);
    this.im = new Float64Array(M);
    this.mag = new Float64Array(M);
    this.pad = 2;
    this.span = Math.ceil(this.symN + 2 * (this.kern.half + this.pad) + 4);
    this.buf = new Float32Array(this.span);
    this.yr = new Float64Array(this.span);
    this.yi = new Float64Array(this.span);
    this.tr = new Float64Array(M); // dechirp edilmiş zaman örnekleri (FFT öncesi)
    this.ti = new Float64Array(M);
    this.offset = 0; // zaman düzeltmesi (örnek)
    this.rate = 0; // sembol başına kayma (örnek): saat farkı, hareket
    this.cfo = 0; // frekans kayması (kutu), dechirp'te düzeltilir
    this.outliers = 0;
    this.refs = [];
    this.bitsPerSymbol = p.sf;
  }

  symbolStart(j) {
    return this.start + j * this.symN + this.offset;
  }

  windowEnd(j) {
    return Math.floor(this.symbolStart(j) + this.symN + this.kern.half + this.pad) + 3;
  }

  /** Sembol penceresini okuyup temel banda karıştırır (y = r · e^{−jωc i}). */
  load(store, j) {
    this.from = Math.floor(this.symbolStart(j)) - this.kern.half - this.pad - 1;
    if (!store.read(this.from, this.buf)) return false;
    let pr = Math.cos(this.wc * this.from);
    let pi = -Math.sin(this.wc * this.from);
    const dr = Math.cos(this.wc);
    const di = -Math.sin(this.wc);
    for (let i = 0; i < this.span; i++) {
      this.yr[i] = this.buf[i] * pr;
      this.yi[i] = this.buf[i] * pi;
      const t = pr * dr - pi * di;
      pi = pr * di + pi * dr;
      pr = t;
    }
    return true;
  }

  /** Çip anlarında temel bant örnekleri, dechirp ve frekans düzeltmesi; FFT sonucu re/im'de. */
  dechirp(j) {
    const s0 = this.symbolStart(j);
    const { M } = this.info;
    const { half, table } = this.kern;
    let pr = 1;
    let pi = 0;
    const rr = Math.cos((-TWO_PI * this.cfo) / M);
    const ri = Math.sin((-TWO_PI * this.cfo) / M);
    for (let m = 0; m < M; m++) {
      const u = s0 + m * this.fsB - this.from; // tampon içinde kesirli konum
      let zr = 0;
      let zi = 0;
      for (let i = Math.max(0, Math.ceil(u - half)); i <= u + half && i < this.span; i++) {
        const x = (i - u + half) * TABLE;
        const k = Math.floor(x);
        const h = table[k] + (x - k) * (table[k + 1] - table[k]);
        zr += this.yr[i] * h;
        zi += this.yi[i] * h;
      }
      // dechirp: · conj(c0), frekans düzeltmesi: · e^{−j2π·cfo·m/M}
      const dr = zr * this.cr[m] - zi * this.ci[m];
      const di = zr * this.ci[m] + zi * this.cr[m];
      this.tr[m] = dr * pr - di * pi;
      this.ti[m] = dr * pi + di * pr;
      const t = pr * rr - pi * ri;
      pi = pr * ri + pi * rr;
      pr = t;
    }
    this.re.set(this.tr);
    this.im.set(this.ti);
    this.fft.transform(this.re, this.im);
  }

  /** k kutusunun, m ∈ [from, to) kesiminde, k + φ frekansındaki tutarlı toplamı. */
  segment(k, phi, from, to) {
    const { M } = this.info;
    const w = (-TWO_PI * (k + phi)) / M;
    let pr = Math.cos(w * from);
    let pi = Math.sin(w * from);
    const rr = Math.cos(w);
    const ri = Math.sin(w);
    let sr = 0;
    let si = 0;
    for (let m = from; m < to; m++) {
      sr += this.tr[m] * pr - this.ti[m] * pi;
      si += this.tr[m] * pi + this.ti[m] * pr;
      const t = pr * rr - pi * ri;
      pi = pr * ri + pi * rr;
      pr = t;
    }
    return [sr, si];
  }

  /**
   * Karar verilen k için ton frekansı φ = ε − τ (kutu) ve zaman kayması τ (çip).
   * Kesimlerden biri çok kısaysa τ güvenilmez: null.
   */
  offsets(k) {
    const { M } = this.info;
    const wrap = (M - k) % M; // sarmanın olduğu çip (s = 0'da sarma yok)
    const cut = wrap > 1 && wrap < M - 1;
    const energy = (phi) => {
      if (!cut) {
        const [a, b] = this.segment(k, phi, 0, M);
        return a * a + b * b;
      }
      const [a, b] = this.segment(k, phi, 0, wrap - 1);
      const [c, d] = this.segment(k, phi, wrap + 1, M);
      return a * a + b * b + c * c + d * d;
    };
    // kaba ızgara, sonra parabolik inceltme
    let best = 0;
    let bestE = -1;
    const grid = [-0.5, -0.375, -0.25, -0.125, 0, 0.125, 0.25, 0.375, 0.5];
    const E = grid.map((g) => energy(g));
    for (let i = 0; i < grid.length; i++) if (E[i] > bestE) (bestE = E[i]), (best = i);
    let phi = grid[best];
    if (best > 0 && best < grid.length - 1) {
      const den = E[best - 1] - 2 * E[best] + E[best + 1];
      if (den < 0) phi += (0.125 * 0.5 * (E[best - 1] - E[best + 1])) / den;
    }
    if (!cut || Math.min(wrap, M - wrap) < M / 8) return { phi, tau: null };
    const [a, b] = this.segment(k, phi, 0, wrap - 1);
    const [c, d] = this.segment(k, phi, wrap + 1, M);
    // S2 · conj(S1) = e^{j2πτ}; faz gürültüsü her kesimde σ²·L / (2|S|²)
    const tau = Math.atan2(d * a - c * b, c * a + d * b) / TWO_PI;
    const n1 = (wrap - 1) / M / (2 * (a * a + b * b) + 1e-30);
    const n2 = (M - wrap - 1) / M / (2 * (c * c + d * d) + 1e-30);
    return { phi, tau, n1, n2 };
  }

  read(store, j) {
    if (!this.load(store, j)) return null;
    this.dechirp(j);
    const { M } = this.info;
    const sf = this.p.sf;
    let best = 0;
    let total = 0;
    for (let k = 0; k < M; k++) {
      const e = this.re[k] * this.re[k] + this.im[k] * this.im[k];
      this.mag[k] = Math.sqrt(e);
      total += e;
      if (this.mag[k] > this.mag[best]) best = k;
    }
    let second = 0;
    for (let k = 0; k < M; k++) if (k !== best && this.mag[k] > second) second = this.mag[k];
    const peak = this.mag[best];
    const margin = 20 * Math.log10(peak / (second || 1e-12));
    const noise = Math.max(1e-12, (total - peak * peak) / (M - 1));
    // Güvenilirlik marjla değil, tepenin gürültü tabanına oranıyla ölçülür: yarım kutuluk
    // Doppler'de enerji iki komşu kutuya bölünür, marj sıfıra iner ama ölçüm hâlâ nettir.
    const peakDb = 10 * Math.log10((peak * peak) / noise);
    if (j < REF_SYMBOLS) {
      // Başvuru (s = M/2). Tepenin kayması (d + φ = ε − τ) Doppler ile zaman hatasının
      // farkıdır; zaman hatası τ sarma anındaki faz sıçramasından ayrıca ölçülür. Senkronun
      // tam sayı çip hatası yapmadığı varsayılır (chirp senkronu örnek düzeyinde doğru); böylece
      // ultrasonikte yarım kutuyu aşan Doppler zaman hatası sanılmaz. Her başvurudan sonra
      // zamanlama güvenilirlikle orantılı düzeltilir; kalan hata sembol başı kaymadır.
      const d = best - M / 2;
      if (Math.abs(d) <= 2 && peakDb > 6) {
        const { phi, tau, n1, n2 } = this.offsets(best);
        const R = (noise * (n1 + n2)) / (TWO_PI * TWO_PI) + 1e-4;
        this.offset += (SYNC_VAR / (SYNC_VAR + R)) * tau * this.fsB;
        this.refs.push({ j, tau, eps: d + phi + tau, R, peakDb });
      }
      // hız ve Doppler yalnız başvurular netken başlatılır; düşük SNR'de sıfırdan başlamak güvenli
      const refs = this.refs;
      if (j === REF_SYMBOLS - 1 && refs.length === REF_SYMBOLS && Math.min(...refs.map((r) => r.peakDb)) > RELIABLE_DB) {
        const later = refs.slice(1);
        const w = later.reduce((a, r) => a + 1 / r.R, 0);
        const v = later.reduce((a, r) => a + r.tau / r.R, 0) / w;
        const max = MAX_RATE * this.info.T * this.info.B; // çip/sembol
        this.rate = Math.max(-max, Math.min(max, (RATE_VAR / (RATE_VAR + 1 / w)) * v)) * this.fsB;
        this.offset += this.rate;
        this.cfo = Math.max(-MAX_CFO, Math.min(MAX_CFO, refs.reduce((a, r) => a + r.eps, 0) / refs.length));
      }
      return { soft: null };
    }
    if (peakDb > 6) {
      const { phi, tau, n1, n2 } = this.offsets(best);
      if (tau !== null) {
        // Alfa-beta izleyici (sabit kazançlı Kalman): kazanç, ölçüm varyansı R ile hareketin
        // beklenen sembol başı değişimi Q oranından. Yanlış karar verilmiş sembolün τ'su
        // rastgeledir; beklenenden çok büyük sapmalar (üst üste gelmedikçe) atlanır.
        const R = (noise * (n1 + n2)) / (TWO_PI * TWO_PI) + 1e-4;
        if (Math.abs(tau) < Math.max(GATE, 3 * Math.sqrt(R + TRACK_VAR)) || ++this.outliers >= 3) {
          this.outliers = 0;
          const alpha = Math.max(0.1, Math.min(0.8, TRACK_VAR / (TRACK_VAR + R)));
          const beta = (alpha * alpha) / (2 - alpha);
          this.offset += alpha * tau * this.fsB; // geç gelen sembol → pozitif
          this.rate += beta * tau * this.fsB;
          // Doppler (ε = φ + τ): yavaş değişir; yalnız net sembollerle, küçük kazançla izlenir
          if (peakDb > RELIABLE_DB) this.cfo = Math.max(-MAX_CFO, Math.min(MAX_CFO, this.cfo + 0.15 * (phi + tau)));
        }
      }
    }
    this.offset += this.rate;
    const scale = (2 * peak) / noise;
    const soft = new Float32Array(sf);
    const max0 = new Float64Array(sf);
    const max1 = new Float64Array(sf);
    for (let k = 0; k < M; k++) {
      const v = gray(k);
      const m = this.mag[k];
      for (let b = 0; b < sf; b++) {
        if ((v >> (sf - 1 - b)) & 1) {
          if (m > max1[b]) max1[b] = m;
        } else if (m > max0[b]) max0[b] = m;
      }
    }
    for (let b = 0; b < sf; b++) soft[b] = scale * (max0[b] - max1[b]);
    return { soft, margin, snr: peakDb - 10 * Math.log10(M) };
  }
}
