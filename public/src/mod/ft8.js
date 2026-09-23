// FT8 — 8-GFSK, Costas senkronu ve LDPC(174, 91) (Mod 7; Franke, Somerville ve Taylor 2020).
//
// FT8, amatör telsizde çok zayıf sinyaller için geliştirilmiş bir kiplemedir: sekiz tonlu, sürekli
// fazlı frekans kaydırma (8-FSK, sembol başına 3 bit, Gray kodlu), modülasyon indisi h = 1 (ton
// aralığı = 1 / T; tonlar sembol süresinde dik), frekans geçişleri Gauss süzgeçle yumuşatılmış
// (GFSK, BT = 2: yan bantlar dar, zarf sabit; hoparlör sonuna kadar sürülebilir). Her çerçeve 79
// semboldür: S7 D29 S7 D29 S7. S7, 7 × 7 Costas dizisidir ({3, 1, 4, 0, 6, 5, 2}): zaman ve frekans
// kaymalarında öz ilintisi tek bir tepe verir (Costas 1984); alıcı zamanı ve frekansı buradan ölçer.
// D29 + D29 = 58 veri sembolü = 174 bit = bir LDPC(174, 91) kod sözcüğü (bkz. codec/ldpc.js); kod
// bitleri sırayla, 3'erli gruplar hâlinde sembollere dağılır (FT8'deki gibi, ek serpiştirme yok).
//
// Alıcı her sembolde 8 tonun enerjisini dikdörtgen pencereli DFT ile ölçer (pencere = T, tonlar
// dik). Yankısız kanalda ton m'nin ölçütü eş fazsız FSK'nin olabilirlik oranıdır (Rice / Rayleigh:
// log I0(2·√(A·E_m) / σ²) − A / σ²); bitlerin LLR'si, o biti 0 ve 1 yapan tonların sonsal olasılık
// toplamlarından gelir. A ve σ² Costas sembollerinden (bilinen ton) ve güvenli kararlardan sürekli
// kestirilir; LLR'ler böylece inanç yayılımının gerektirdiği gerçek ölçeğe yakın olur. Her Costas
// bloğunda zaman (±T/4) ve frekans (±½ ton; Doppler, saat farkı) iki boyutlu aramayla ölçülür ve
// alfa-beta izleyiciyle sonraki sembollere taşınır.
//
// Oda yankısı: ton kümesi değiştirmeyen 8-FSK'de önceki sembolün yankısı şimdiki pencereye, hep aynı
// 8 tondan birine düşer (benzetimde uzak odada sembol hatalarının %65–80'i "önceki sembolün tonu"
// çıktı). Dalga formuna dokunmadan alıcıya iki önlem eklendi (FT8'in parçası değil): (1) ton başına
// kanal modeli: her tonun doğrudan, yankı (önceki sembolden taşan) ve tekrar düzeyleri ayrı ayrı
// öğrenilir (bkz. ToneModel); (2) her 29 sembollük veri bloğu, durumu "önceki ton" olan 8 durumlu
// kafeste ileri-geri (BCJR; Bahl, Cocke, Jelinek ve Raviv 1974) çözülür, bloğun iki ucundaki Costas
// tonları bilinen durumdur. Yankı böylece gürültü değil, önceki sembol için ek kanıt olur.
//
// Paket: [başlık + veri] kod sözcükleri alt kanallara sırayla dağılır: başlık çerçevesinin 0. alt
// kanalı başlığı, diğerleri verinin ilk kod sözcüklerini taşır; sonraki çerçeveler veriyle devam
// eder. Her alt kanalın her çerçevesi tam bir FT8 çerçevesidir.
//
// Özgün FT8'den sapmalar (havada ses için uyarlama):
//  1. Zamanlama: FT8'de T = 160 ms, ton aralığı 6,25 Hz (77 bit / 12,64 s). Burada T ve ton aralığı
//     birlikte ölçeklenir, h = 1 korunur (profile göre 80 ms / 12,5 Hz ya da 40 ms / 25 Hz).
//  2. Alt kanallar: hızı artırmak için profil, farklı frekans kaymalarında `subchannels` adet eş
//     zamanlı FT8 sinyali gönderir (FT8 kullanıcılarının aynı bandı paylaşması gibi; aralarında 2
//     ton boşluk). Tek alt kanalda zarf sabittir; N alt kanalda tepe/ortalama oranı artar ve hoparlör
//     aynı tepe genliğiyle sürüldüğünde ortalama güç ~1/N'ye düşer (renderFt8 tepeyi sınırlar).
//     Benzetimdeki SNR ortalama güce göre olduğundan bu kayıp tablolarda görünmez.
//  3. İçerik: FT8'in 77 bitlik mesaj + 14 bitlik CRC'si yerine Sonik'in bit akışı 91 bitlik
//     bloklara bölünür; RS dış kod ve CRC-32 çerçeveden gelir, CRC-14 yoktur. Son blok sıfırla
//     tamamlanır, alıcı bu bitleri bilir. Başlık tek kod sözcüğüdür (56 bilgi + 35 bilinen bit).
//  4. Senkron: FT8'in 15 sn'lik zaman dilimi yerine paket başındaki chirp kaba zamanı verir; Costas
//     blokları yalnız ince zaman/frekans düzeltmesi ve izleme için kullanılır (FT8 alıcısı Costas
//     ilintisiyle aday da arar).
//  5. Son çerçevede boş kalan alt kanallar, o çerçevedeki kod sözcüklerini yineler (güç sabit
//     kalsın; alıcı LLR'leri toplar).
//  6. Alıcı: yukarıdaki yankı modeli ve kafes çözümü eklidir; kod çözücü yalnız inanç yayılımıdır
//     (WSJT-X'in OSD'si ve a priori çözümü yoktur).

import { headerCodedBits } from '../codec/framing.js';

const TWO_PI = 2 * Math.PI;
export const COSTAS = [3, 1, 4, 0, 6, 5, 2]; // kFT8_Costas_pattern (ft8_lib, MIT)
export const GRAY = [0, 1, 3, 2, 5, 6, 4, 7]; // 3 bit → ton (kFT8_Gray_map)
const TONE_BITS = new Uint8Array(8); // ton → 3 bit
GRAY.forEach((tone, bits) => (TONE_BITS[tone] = bits));
const FRAME = 79;
const DATA = 58; // veri sembolü / çerçeve
const CW = 174; // kod sözcüğü (bit)
const BT = 2; // GFSK Gauss süzgecinin bant genişliği × sembol süresi
const GUARD_TONES = 2; // alt kanallar arasında boş ton sayısı
// Costas aramasında pencere Q alt bloğa bölünür; zaman ±R alt blok (±T/4), frekans ±½ ton aranır.
const Q = 16;
const R = 4;
// Ton enerjileri: pencere FINE·Q ince alt bloğa bölünür (sembol başına 64); işaret alt kanalın
// ortasına (ton 3,5) karıştırılıp alt bloklarda toplanır, 8 ton bu 64 toplamın DFT'sidir. Tam DFT'ye
// göre ~6 kat ucuz; alt blok içindeki dönme en uç tonda genliği %0,5 azaltır (−0,04 dB).
const FINE = 4;
const SUB = Q * FINE;
const TWIDDLE = Array.from({ length: 8 }, (_, k) => {
  const re = new Float64Array(SUB);
  const im = new Float64Array(SUB);
  for (let b = 0; b < SUB; b++) {
    const a = (-TWO_PI * (k - 3.5) * (b + 0.5)) / SUB;
    re[b] = Math.cos(a);
    im[b] = Math.sin(a);
  }
  return { re, im };
});
const FREQ_STEPS = 8; // yarım ton aralığındaki adım sayısı (1/16 ton)
const ECHO = 4; // yankı modelinde geriye bakılan sembol sayısı
const FORGET = 0.9; // ton düzeyi ortalamalarının unutma çarpanı (hareketle sönüm deseni değişir)
const GFORGET = 0.97; // ortak ortalamaların unutma çarpanı
const FADE = 0.5; // tekrar düzeyinin ön bilgisinin göreli yayılımı
const MIN_FADE = 0.1; // tonlar arası düzey yayılımının alt sınırı (göreli)
const CLAMP_LLR = 30;

const infoCache = new WeakMap();

/** Profil bilgisi: sembol süresi, ton aralığı (1 / T), alt kanal taban frekansları, bant ve kodlu bit hızı. */
export function ft8Info(p) {
  let info = infoCache.get(p);
  if (!info) {
    const T = p.symbolDur;
    const df = 1 / T;
    const N = p.subchannels ?? 1;
    const step = (8 + GUARD_TONES) * df;
    const bases = Array.from({ length: N }, (_, s) => p.fBase + s * step);
    info = {
      T,
      df,
      N,
      bases,
      lo: p.fBase - df,
      hi: bases[N - 1] + 8 * df,
      center: p.fBase + ((N - 1) * step + 7 * df) / 2,
      codedBitRate: (N * CW) / (FRAME * T),
    };
    infoCache.set(p, info);
  }
  return info;
}

/**
 * Kod sözcükleri alt kanallara sırayla dağılır: z. yuva (çerçeve r, alt kanal s; z = r·N + s) z. kod
 * sözcüğünü taşır. Sıra: başlığın kod sözcüğü (0), sonra verininkiler. Başlık çerçevesinin diğer alt
 * kanalları da veri taşır. Son çerçevede boş kalan yuvalar o çerçevenin kod sözcüklerini yineler.
 */
function slotCodeword(z, count, N) {
  if (z < count) return z;
  const base = (Math.ceil(count / N) - 1) * N;
  return base + ((z - base) % (count - base));
}

const framesFor = (count, N) => Math.ceil(count / N);

export function ft8SymbolCount(p, headerBits, payloadBits) {
  const { N } = ft8Info(p);
  return FRAME * framesFor((headerBits + payloadBits) / CW, N);
}

/** Çerçeve içi sembol konumu → veri sembolü sırası (Costas ise −1). */
function dataIndex(i) {
  if (i >= 7 && i < 36) return i - 7;
  if (i >= 43 && i < 72) return i - 14;
  return -1;
}

/** Kodlu bitler (başlık + veri kod sözcükleri art arda) → alt kanal başına ton dizileri (Costas + Gray kodlu). */
export function toneSequences(bits, N) {
  const count = bits.length / CW;
  const frames = framesFor(count, N);
  const seqs = Array.from({ length: N }, () => new Uint8Array(frames * FRAME));
  for (let r = 0; r < frames; r++) {
    for (let s = 0; s < N; s++) {
      const c = slotCodeword(r * N + s, count, N);
      const seq = seqs[s];
      for (let i = 0; i < FRAME; i++) {
        const d = dataIndex(i);
        let tone;
        if (d < 0) tone = COSTAS[i >= 72 ? i - 72 : i >= 36 ? i - 36 : i];
        else {
          const o = c * CW + 3 * d;
          tone = GRAY[(bits[o] << 2) | (bits[o + 1] << 1) | bits[o + 2]];
        }
        seq[r * FRAME + i] = tone;
      }
    }
  }
  return seqs;
}

/** Hata işlevi (Abramowitz ve Stegun 7.1.26, |hata| < 1,5e-7). */
function erf(x) {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const poly = (((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592;
  const y = 1 - poly * t * Math.exp(-a * a);
  return s * y;
}

// GFSK frekans darbesi (ft8_lib gfsk_pulse ile aynı biçim): dikdörtgen sembol darbesi ∗ Gauss.
// p(τ) = [erf(k·BT·(τ + ½)) − erf(k·BT·(τ − ½))] / 2, τ sembol cinsinden, k = π·√(2 / ln 2).
const GFSK_K = Math.PI * Math.sqrt(2 / Math.LN2);
const PULSE_RES = 1024;
const PULSE = [-1, 0, 1].map((d) =>
  Float64Array.from({ length: PULSE_RES + 1 }, (_, i) => {
    const tau = i / PULSE_RES - 0.5 - d; // bu sembolün ortasına göre (d: komşu sembol)
    return (erf(GFSK_K * BT * (tau + 0.5)) - erf(GFSK_K * BT * (tau - 0.5))) / 2;
  }),
);

/**
 * Semboller out'a eklenir (başlık ve veri kod sözcükleri yuvalara slotCodeword ile dağılır). Her alt
 * kanal sürekli fazlı GFSK'dir: anlık frekans, komşu sembollerin tonlarının Gauss yumuşatmalı
 * toplamıdır. İlk ve son sembolün dışı aynı tonla uzatılır, paketin iki ucu T/8'lik kosinüs rampayla
 * açılıp kapanır (ft8_lib'deki gibi). Alt kanalların toplamının tepesi amplitude'a ölçeklenir.
 */
export function renderFt8(out, start, headerBits, payloadBits, p, fs, amplitude) {
  const { T, df, N, bases } = ft8Info(p);
  const all = new Uint8Array(headerBits.length + payloadBits.length);
  all.set(headerBits);
  all.set(payloadBits, headerBits.length);
  const seqs = toneSequences(all, N);
  const S = seqs[0].length;
  const first = Math.max(0, Math.ceil(start));
  const end = start + S * T * fs;
  const last = Math.min(out.length - 1, Math.ceil(end) - 1);
  if (last < first) return first;
  const buf = new Float64Array(last - first + 1);
  const symN = T * fs;
  for (let s = 0; s < N; s++) {
    const seq = seqs[s];
    let phi = (s * TWO_PI) / (N + 1); // alt kanallar farklı fazla başlasın
    for (let i = first; i <= last; i++) {
      const u = (i - start) / symN;
      const j = Math.min(S - 1, Math.max(0, Math.floor(u)));
      const x = (u - j) * PULSE_RES;
      const k = Math.min(PULSE_RES - 1, Math.max(0, Math.floor(x)));
      const w = Math.min(1, Math.max(0, x - k));
      let tone = 0;
      for (let d = -1; d <= 1; d++) {
        const q = PULSE[d + 1];
        tone += seq[Math.min(S - 1, Math.max(0, j + d))] * (q[k] + w * (q[k + 1] - q[k]));
      }
      buf[i - first] += Math.sin(phi);
      phi += (TWO_PI * (bases[s] + tone * df)) / fs;
      if (phi > TWO_PI) phi -= TWO_PI;
    }
  }
  const rampN = symN / 8;
  let peak = 0;
  for (let i = first; i <= last; i++) {
    const edge = Math.min(i - start, end - i);
    if (edge < rampN) buf[i - first] *= 0.5 - 0.5 * Math.cos((Math.PI * Math.max(0, edge)) / rampN);
    peak = Math.max(peak, Math.abs(buf[i - first]));
  }
  const g = amplitude / (peak || 1);
  for (let i = first; i <= last; i++) out[i] += g * buf[i - first];
  return last + 1;
}

// log I0 için Abramowitz ve Stegun 9.8.1–9.8.2 katsayıları (hata < 2e-7)
const I0_SMALL = [1, 3.5156229, 3.0899424, 1.2067492, 0.2659732, 0.0360768, 0.0045813];
const I0_LARGE = [
  0.39894228, 0.01328592, 0.00225319, -0.00157565, 0.00916281, -0.02057706, 0.02635537, -0.01647633, 0.00392377,
];
function horner(c, t) {
  let acc = 0;
  for (let i = c.length - 1; i >= 0; i--) acc = acc * t + c[i];
  return acc;
}

/** log I0(x), x ≥ 0. */
export function logI0(x) {
  if (x < 3.75) return Math.log(horner(I0_SMALL, (x / 3.75) ** 2));
  return x - 0.5 * Math.log(x) + Math.log(horner(I0_LARGE, 3.75 / x));
}

/** Rice dağılımının log yoğunluğu: E = |LOS + gauss|², LOS gücü L, dağınık güç v. */
function logRice(E, L, v) {
  return -Math.log(v) - (E + L) / v + (L > 0 ? logI0((2 * Math.sqrt(E * L)) / v) : 0);
}

/** Ton başına üstel unutmalı ortalama; az gözlemde ortak ortalamaya büzülen kestirim (Bayes). */
class ToneStat {
  constructor() {
    this.sum = new Float64Array(8);
    this.n = new Float64Array(8);
    this.gsum = 0;
    this.gn = 0;
  }

  add(k, x) {
    this.sum[k] = FORGET * this.sum[k] + x;
    this.n[k] = FORGET * this.n[k] + 1;
    this.gsum = GFORGET * this.gsum + x;
    this.gn = GFORGET * this.gn + 1;
  }

  global() {
    return this.gn > 0 ? Math.max(0, this.gsum / this.gn) : 0;
  }

  /**
   * Ton başına kestirimler (Bayes büzülmesi, deneysel ön bilgi): ton ortalamaları ortak ortalama
   * prior'a, gözlem sayısı ve ölçüm gürültüsüne (gözlem başı varyans meas) göre çekilir. Tonlar
   * arası gerçek yayılım, ton ortalamalarının yayılımından ölçüm gürültüsü çıkarılarak bulunur;
   * yankısız kanalda sıfıra yakındır, yankılı odada büyür. out[k] ← kestirim.
   */
  shrink(prior, meas, minSpread, out) {
    let s2 = 0;
    let noise = 0;
    let c = 0;
    for (let k = 0; k < 8; k++) {
      if (!(this.n[k] > 0.5)) continue;
      const mu = this.sum[k] / this.n[k];
      s2 += (mu - prior) ** 2;
      noise += meas / this.n[k];
      c++;
    }
    const t2 = c < 3 ? minSpread * minSpread : Math.max(minSpread * minSpread, (s2 - noise) / c);
    for (let k = 0; k < 8; k++) {
      if (!(this.n[k] > 0)) {
        out[k] = prior;
        continue;
      }
      const w = (this.n[k] * t2) / (this.n[k] * t2 + meas + 1e-30);
      out[k] = Math.max(0, prior + w * (this.sum[k] / this.n[k] - prior));
    }
    return out;
  }
}

/**
 * Alt kanal başına ton kanalı modeli (gözlem: 8 ton kutusunun enerjisi E_k). Oda sabitken her
 * tonun kanalı da sabittir; bir tonun bu sembolde görülen enerjisi, o tonun şimdi (a) ve bir önceki
 * sembolde (b) gönderilip gönderilmediğine bağlı, tona özgü bir düzeydir:
 *   a = 0, b = 0: yalnız dağınık enerji v_k (gürültü + eski yankılar)
 *   a = 1, b = 0: doğrudan düzey A_k (tonların sönümü birbirinden bağımsız)
 *   a = 0, b = 1: yankı düzeyi e_k (önceki sembolün bu pencereye taşan yankısı)
 *   a = 1, b = 1: tekrar düzeyi r_k (aynı ton üst üste)
 * E_k bu düzeyin çevresinde Rice dağılır (LOS gücü = düzey, dağınık güç v_k). v_k = σ0² +
 * Σ_{d ≥ 2} ρ_d · E_{j−d}(k): daha eski sembollerin yankısı, gözlenen enerjileriyle orantılı eklenir.
 * b bilinmediğinden çözücü, durumu önceki ton olan kafeste ileri-geri çalışır (Ft8Demod.decodeBlock).
 * Yankısız kanalda e ve v'deki yankı payı sıfıra iner; ölçüt olağan eş fazsız FSK olabilirliği olur
 * (ton m için log I0(2·√(A_m·E_m) / v) − A_m / v). Düzeyler Costas sembollerinden (ton ve önceki ton
 * bilinir) ve güvenli kararlardan öğrenilir.
 */
class ToneModel {
  constructor() {
    this.hist = Array.from({ length: ECHO }, () => new Float64Array(8)); // son sembollerin enerjileri (yeni önce)
    this.prev = new Float64Array(8); // π: önceki sembolün ton olasılıkları (hepsi 0: önceki sembol yok)
    this.floor = 0; // σ0²
    this.direct = new ToneStat();
    this.echo = new ToneStat();
    this.repeat = new ToneStat();
    this.v = new Float64Array(8);
    this.A = new Float64Array(8);
    this.e = new Float64Array(8);
    this.r = new Float64Array(8);
  }

  /** Ortak doğrudan düzey (tüm tonların ortalaması). */
  signal() {
    return this.direct.global();
  }

  /** Dağınık güç v_k (eski, d ≥ 2 yankılar dahil; hist: son sembollerin enerjileri, yeni önce) ve tona özgü düzeyler. */
  prepare(rho, hist = this.hist) {
    const floor = Math.max(this.floor, 1e-20);
    for (let k = 0; k < 8; k++) {
      let v = floor;
      for (let d = 2; d <= ECHO; d++) v += rho[d] * hist[d - 1][k];
      this.v[k] = v;
    }
    const G = Math.max(this.signal(), 1e-3 * floor);
    const Ge = this.echo.global();
    const meas = (L) => 2 * L * floor + floor * floor; // Rice enerjisinin varyansı (LOS L, dağınık σ0²)
    this.direct.shrink(G, meas(G), MIN_FADE * G, this.A);
    this.echo.shrink(Ge, meas(Ge), MIN_FADE * Ge, this.e);
    for (let k = 0; k < 8; k++) {
      this.A[k] = Math.max(1e-3 * G, this.A[k]);
      this.r[k] = this.A[k] + this.e[k]; // ön bilgi: iki bileşen rastgele fazla toplanır
    }
    for (let k = 0; k < 8; k++) {
      const n = this.repeat.n[k];
      if (n > 0) {
        const t2 = (FADE * this.r[k]) ** 2;
        const w = (n * t2) / (n * t2 + meas(this.r[k]) + 1e-30);
        this.r[k] = Math.max(0, this.r[k] + w * (this.repeat.sum[k] / n - this.r[k]));
      }
    }
  }

  /**
   * Bir sembolün ton başına dört log olabilirliği (prepare'den sonra), out[o + 8·durum + k]:
   * durum 0: (a, b) = (0, 0), 1: (1, 0), 2: (0, 1), 3: (1, 1).
   */
  terms(E, out, o) {
    for (let k = 0; k < 8; k++) {
      const v = this.v[k];
      out[o + k] = logRice(E[k], 0, v);
      out[o + 8 + k] = logRice(E[k], this.A[k], v);
      out[o + 16 + k] = logRice(E[k], this.e[k], v);
      out[o + 24 + k] = logRice(E[k], this.r[k], v);
    }
  }

  /**
   * Sembolü modele katar. post: bu sembolün ton olasılıkları (Costas'ta bilinen tonun tek noktası).
   * Taban, şimdiki ve önceki (en olası) ton dışındaki tonlardan; düzeyler yalnız şimdiki ve önceki
   * karar güvenliyse (olasılık > 0,95) öğrenilir. g: tabanın güncelleme kazancı.
   */
  update(E, post, rho, g) {
    let m = 0;
    let p = 0;
    for (let k = 1; k < 8; k++) {
      if (post[k] > post[m]) m = k;
      if (this.prev[k] > this.prev[p]) p = k;
    }
    const hasPrev = this.prev[p] > 0.95;
    let r = 0;
    let cnt = 0;
    for (let k = 0; k < 8; k++) {
      if (k === m || (hasPrev && k === p)) continue;
      let echo = 0;
      for (let d = 2; d <= ECHO; d++) echo += rho[d] * this.hist[d - 1][k];
      r += E[k] - echo;
      cnt++;
    }
    const sample = Math.max(0, r / cnt);
    this.floor = this.floor > 0 ? this.floor + g * (sample - this.floor) : sample;
    this.prepare(rho);
    if (post[m] > 0.95) {
      const prevKnown = this.prev[p] > 0.95 || this.prev.every((x) => x === 0);
      if (prevKnown && (m !== p || !hasPrev)) {
        this.direct.add(m, E[m] - this.v[m]);
        if (hasPrev) this.echo.add(p, E[p] - this.v[p]);
      } else if (hasPrev && m === p) this.repeat.add(m, E[m] - this.v[m]);
    }
    const last = this.hist.pop();
    last.set(E);
    this.hist.unshift(last);
    this.prev.set(post);
  }
}

/**
 * Tek paketin FT8 çözücüsü. read(j): Costas bloğunun ilk sembolünde zaman ve frekansı ölçer (blok
 * boyunca diğer semboller için {} döner); veri sembollerinde alt kanal başına 3 bitin LLR'sini verir.
 */
export class Ft8Demod {
  constructor(p, fs, start) {
    const info = ft8Info(p);
    this.p = p;
    this.info = info;
    this.fs = fs;
    this.start = start;
    this.N = info.N;
    this.symN = info.T * fs;
    this.Lf = Math.max(1, Math.round(this.symN / SUB)); // ince alt blok (örnek)
    this.Lb = FINE * this.Lf; // Costas aramasının alt bloğu (T/16)
    this.W = Q * this.Lb; // DFT penceresi ≈ T
    this.Br = new Float64Array(SUB);
    this.Bi = new Float64Array(SUB);
    this.bitsPerSymbol = 3 * info.N;
    this.headerCodewords = headerCodedBits(p) / CW; // 1: başlık çerçevesinin 0. yuvası
    this.frame0 = null; // başlık çerçevesinin LLR'leri (diğer yuvalar veri taşır)
    // izleme durumu: symbolStart(j) = start + j·symN + off + rate·(j − jRef)
    this.off = 0;
    this.rate = 0;
    this.jRef = 0;
    this.lastBlock = -1;
    this.kappa = 0; // frekans ölçeği: alınan f = gönderilen f · (1 + κ) (Doppler + saat farkı)
    this.blocks = 0;
    this.models = Array.from({ length: info.N }, () => new ToneModel());
    this.rhoNum = new Float64Array(ECHO + 1); // yankı katsayıları ρ_d = Σ pay / Σ payda (Costas'tan)
    this.rhoDen = new Float64Array(ECHO + 1);
    this.rhoVar = new Float64Array(ECHO + 1);
    this.rho = new Float64Array(ECHO + 1);
    this.known = new Float64Array(8);
    this.buf = new Float32Array(this.W);
    this.E = new Float64Array(8);
    // Costas araması: 7 sembol × (Q + 2R) alt blok, alt blok merkezlerinde frekans döndürücüleri
    this.nb = Q + 2 * R;
    this.rot = [];
    for (let f = -FREQ_STEPS; f <= FREQ_STEPS; f++) {
      const d = f / (2 * FREQ_STEPS); // ton aralığı cinsinden
      const re = new Float64Array(this.nb);
      const im = new Float64Array(this.nb);
      for (let q = 0; q < this.nb; q++) {
        const a = (-TWO_PI * d * info.df * (q + 0.5) * this.Lb) / fs;
        re[q] = Math.cos(a);
        im[q] = Math.sin(a);
      }
      this.rot.push({ d, re, im });
    }
  }

  symbolStart(j) {
    return this.start + j * this.symN + this.off + this.rate * (j - this.jRef);
  }

  /** j'nin çerçeve içi konumu i ve (Costas ise) bloğun ilk sembolü. */
  where(j) {
    const i = j % FRAME;
    const b = i >= 72 ? 72 : i >= 43 ? -1 : i >= 36 ? 36 : i >= 7 ? -1 : 0;
    return { i, block: b < 0 ? -1 : j - i + b };
  }

  /** Veri sembolünün bloğu (29 sembol): ilk ve son sembol; bloktan sonra Costas gelir. */
  dataBlock(j) {
    const i = j % FRAME;
    const first = j - i + (i < 36 ? 7 : 43);
    return { first, last: first + 28 };
  }

  windowEnd(j) {
    const { block } = this.where(j);
    if (block >= 0) return Math.floor(this.symbolStart(block + 6)) + this.W + 2 * R * this.Lb + 2;
    // veri bloğu, ardından gelen ilk Costas sembolüyle birlikte bir kerede çözülür
    return Math.floor(this.symbolStart(this.dataBlock(j).last + 1)) + this.W + 2;
  }

  symbolsFor(bits, part) {
    if (part === 'header') return DATA; // başlık çerçevesi
    return (framesFor(this.headerCodewords + bits / CW, this.N) - 1) * DATA;
  }

  payloadSeconds(symbols) {
    return (symbols / DATA) * FRAME * this.info.T;
  }

  /**
   * Düz LLR akışı (sembol sırası, alt kanal, 3 bit) → kod sözcükleri; yinelenen yuvalar toplanır.
   * Başlıkta yalnız 0. yuva okunur (veri uzunluğu henüz bilinmez); çerçevenin tamamı saklanır ve
   * verinin çözümünde, başlık çerçevesinin diğer yuvalarındaki kod sözcükleri buradan alınır.
   */
  deinterleave(flat, n, part) {
    const N = this.N;
    const out = new Float32Array(n);
    const slot = (src, r, s, c) => {
      for (let d = 0; d < DATA; d++) {
        for (let b = 0; b < 3; b++) out[c * CW + 3 * d + b] += src[((r * DATA + d) * N + s) * 3 + b] || 0;
      }
    };
    if (part === 'header') {
      this.frame0 = Float32Array.from(flat);
      slot(flat, 0, 0, 0);
      return out;
    }
    const hc = this.headerCodewords;
    const count = hc + n / CW;
    const frames = framesFor(count, N);
    for (let r = 0; r < frames; r++) {
      for (let s = 0; s < N; s++) {
        const c = slotCodeword(r * N + s, count, N);
        if (c < hc) continue; // başlık
        if (r === 0) {
          if (this.frame0) slot(this.frame0, 0, s, c - hc);
        } else slot(flat, r - 1, s, c - hc);
      }
    }
    return out;
  }

  /** s. alt kanalın ton frekansı (Hz), izlenen frekans ölçeğiyle. */
  toneFreq(s, tone) {
    return (this.info.bases[s] + tone * this.info.df) * (1 + this.kappa);
  }

  /** Pencere (this.buf, W örnek) üzerinde s. alt kanalın 8 ton enerjisi → this.E. */
  toneEnergies(s) {
    const { buf, Lf, Br, Bi, E, fs } = this;
    const w = (TWO_PI * this.toneFreq(s, 3.5)) / fs;
    const cr = Math.cos(w);
    const ci = -Math.sin(w);
    let pr = 1;
    let pi = 0;
    let n = 0;
    for (let b = 0; b < SUB; b++) {
      let sr = 0;
      let si = 0;
      for (const e = n + Lf; n < e; n++) {
        const x = buf[n];
        sr += x * pr;
        si += x * pi;
        const t = pr * cr - pi * ci;
        pi = pr * ci + pi * cr;
        pr = t;
      }
      Br[b] = sr;
      Bi[b] = si;
    }
    for (let k = 0; k < 8; k++) {
      const { re, im } = TWIDDLE[k];
      let xr = 0;
      let xi = 0;
      for (let b = 0; b < SUB; b++) {
        xr += Br[b] * re[b] - Bi[b] * im[b];
        xi += Br[b] * im[b] + Bi[b] * re[b];
      }
      E[k] = xr * xr + xi * xi;
    }
    return E;
  }

  /**
   * Costas bloğu (j0 … j0 + 6): zaman kayması (±T/4) ve frekans kayması (±½ ton) için iki boyutlu
   * arama. Her sembolün bilinen tonuna karıştırılmış işaret alt bloklarda toplanır; kaydırılmış
   * pencerenin ve frekans kaymasının enerjisi bu toplamlardan hesaplanır. Ölçüm izleyiciye verilir,
   * sonra blok sembollerinden gürültü ve sinyal enerjisi kestirilir.
   */
  costas(store, j0) {
    const { N, Lb, nb, fs } = this;
    // okunan bölge: ilk sembolün R alt blok öncesinden son sembolün penceresinin 2R alt blok sonrasına
    // (arama ±R; düzeltmeden sonra bloğun sembolleri yeniden okunur)
    const from = Math.floor(this.symbolStart(j0)) - R * Lb;
    const span = Math.floor(this.symbolStart(j0 + 6)) + this.W + 2 * R * Lb - from;
    const seg = new Float32Array(span);
    if (!store.read(from, seg)) return false;
    const nf = this.rot.length;
    const metric = new Float64Array((2 * R + 1) * nf);
    const Br = new Float64Array(nb);
    const Bi = new Float64Array(nb);
    for (let s = 0; s < N; s++) {
      for (let i = 0; i < 7; i++) {
        const a = Math.floor(this.symbolStart(j0 + i)) - R * Lb - from;
        const w = (TWO_PI * this.toneFreq(s, COSTAS[i])) / fs;
        const cr = Math.cos(w);
        const ci = -Math.sin(w);
        let pr = 1;
        let pi = 0;
        for (let q = 0; q < nb; q++) {
          let sr = 0;
          let si = 0;
          for (let n = a + q * Lb, e = n + Lb; n < e; n++) {
            const x = seg[n];
            sr += x * pr;
            si += x * pi;
            const t = pr * cr - pi * ci;
            pi = pr * ci + pi * cr;
            pr = t;
          }
          Br[q] = sr;
          Bi[q] = si;
        }
        for (let k = 0; k <= 2 * R; k++) {
          for (let f = 0; f < nf; f++) {
            const { re, im } = this.rot[f];
            let xr = 0;
            let xi = 0;
            for (let q = k; q < k + Q; q++) {
              xr += Br[q] * re[q] - Bi[q] * im[q];
              xi += Br[q] * im[q] + Bi[q] * re[q];
            }
            metric[k * nf + f] += xr * xr + xi * xi;
          }
        }
      }
    }
    let best = 0;
    for (let x = 1; x < metric.length; x++) if (metric[x] > metric[best]) best = x;
    const k = Math.floor(best / nf);
    const f = best % nf;
    const at = (kk, ff) => metric[kk * nf + ff];
    // zaman: üçgen tepe uydurma; frekans: parabol
    let dk = 0;
    if (k > 0 && k < 2 * R) {
      const a = at(k - 1, f);
      const b = at(k, f);
      const c = at(k + 1, f);
      const den = 2 * (b - Math.min(a, c));
      if (den > 0) dk = Math.max(-0.5, Math.min(0.5, (c - a) / den));
    }
    let dfq = 0;
    if (f > 0 && f < nf - 1) {
      const a = at(k, f - 1);
      const b = at(k, f);
      const c = at(k, f + 1);
      const den = a - 2 * b + c;
      if (den < 0) dfq = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
    }
    const tau = (k - R + dk) * Lb; // örnek; pozitif: sembol geç geliyor
    const nu = this.rot[f].d + dfq / (2 * FREQ_STEPS); // ton aralığı cinsinden
    this.track(j0, tau, nu);
    // Blok sembolleri (düzeltilmiş zaman ve frekansla) kanal modelini besler: bilinen ton o tonun
    // kazancını, bloğun önceki sembollerinin (hepsi farklı ton) şimdiki penceredeki enerjisi yankı
    // katsayılarını, geri kalan tonlar gürültü tabanını verir.
    for (let i = 0; i < 7; i++) {
      const a = Math.max(0, Math.min(span - this.W, Math.floor(this.symbolStart(j0 + i)) - from));
      this.buf.set(seg.subarray(a, a + this.W));
      for (let s = 0; s < N; s++) {
        const tm = this.models[s];
        const E = this.toneEnergies(s);
        for (let d = 2; d <= ECHO && d <= i; d++) {
          const prev = COSTAS[i - d];
          this.rhoNum[d] += E[prev] - tm.floor;
          this.rhoDen[d] += tm.hist[d - 1][prev];
          this.rhoVar[d] += tm.floor * tm.floor; // gürültü tonunun enerjisi üstel: varyans = ortalama²
        }
        // ρ_d yalnız gürültüden anlamlı biçimde büyükse (pay > 2σ) kullanılır; yoksa gürültülü
        // kestirim yankısız kanalda da tonları haksız yere cezalandırırdı
        for (let d = 2; d <= ECHO; d++) {
          const num = this.rhoNum[d] - 2 * Math.sqrt(this.rhoVar[d]);
          this.rho[d] = this.rhoDen[d] > 0 ? Math.max(0, num / this.rhoDen[d]) : 0;
        }
        this.known.fill(0);
        this.known[COSTAS[i]] = 1;
        tm.update(E, this.known, this.rho, this.blocks === 0 && i === 0 ? 1 : 0.15);
      }
    }
    this.blocks++;
    return true;
  }

  /** İzleyici: zaman için alfa-beta (konum + sembol başı kayma), frekans ölçeği için yumuşatma. */
  track(j0, tau, nu) {
    const pred = this.off + this.rate * (j0 - this.jRef);
    if (this.blocks === 0) {
      this.off = pred + tau;
    } else {
      const alpha = 0.7;
      const beta = (alpha * alpha) / (2 - alpha);
      const dj = Math.max(1, j0 - this.lastBlock);
      this.off = pred + alpha * tau;
      this.rate += (beta * tau) / dj;
      const max = 1e-3 * this.symN; // 1000 ppm'den hızlı kayma olamaz
      this.rate = Math.max(-max, Math.min(max, this.rate));
    }
    this.jRef = j0;
    this.lastBlock = j0;
    const g = this.blocks === 0 ? 1 : 0.4;
    this.kappa += (g * nu * this.info.df) / this.info.center;
    this.kappa = Math.max(-2e-3, Math.min(2e-3, this.kappa));
  }

  /** i. tonun bu sembolde gönderilip (m) önceki sembolde gönderilmiş (p) olmasının log olabilirliği. */
  static gamma(T, o, m, p) {
    if (m === p) return T[o + 24 + m] - T[o + m];
    return T[o + 8 + m] - T[o + m] + T[o + 16 + p] - T[o + p];
  }

  /**
   * Veri bloğunun (first … last) çözümü. Tüm sembollerin ton enerjileri ölçülür; her alt kanal için
   * durumu "önceki ton" olan 8 durumlu kafeste ileri-geri (BCJR; Bahl vd. 1974) sonsal ton
   * olasılıkları bulunur. Bloğun iki ucu bilinen Costas tonlarıdır: baştaki önceki durumu, sondaki
   * Costas sembolü de son veri sembolünün yankısını gözler. Böylece yankı, rahatsız edici değil,
   * önceki sembol hakkında ek kanıt olur. Sonra model sonsallarla güncellenir, bit LLR'leri saklanır.
   */
  decodeBlock(store, first, last) {
    const { N, W } = this;
    const n = last - first + 2; // + ardından gelen Costas sembolü
    const from = Math.floor(this.symbolStart(first));
    const seg = new Float32Array(Math.floor(this.symbolStart(last + 1)) + W - from);
    if (!store.read(from, seg)) return false;
    const energies = [];
    for (let q = 0; q < n; q++) {
      const a = Math.floor(this.symbolStart(first + q)) - from;
      this.buf.set(seg.subarray(a, a + W));
      for (let s = 0; s < N; s++) {
        const E = this.toneEnergies(s).slice();
        energies.push(E);
      }
    }
    const post = Array.from({ length: (n - 1) * N }, () => new Float64Array(8));
    const T = new Float64Array(n * 32);
    const A = new Float64Array((n - 1) * 8);
    const B = new Float64Array((n - 1) * 8);
    const tmp = new Float64Array(8);
    const lse = (arr) => {
      let m = -Infinity;
      for (const x of arr) if (x > m) m = x;
      if (m === -Infinity) return m;
      let t = 0;
      for (const x of arr) t += Math.exp(x - m);
      return m + Math.log(t);
    };
    const normalize = (arr, o) => {
      let m = -Infinity;
      for (let k = 0; k < 8; k++) if (arr[o + k] > m) m = arr[o + k];
      for (let k = 0; k < 8; k++) arr[o + k] -= m;
    };
    for (let s = 0; s < N; s++) {
      const tm = this.models[s];
      const hist = tm.hist.map((h) => h.slice());
      for (let q = 0; q < n; q++) {
        const E = energies[q * N + s];
        tm.prepare(this.rho, hist);
        tm.terms(E, T, q * 32);
        const h = hist.pop();
        h.set(E);
        hist.unshift(h);
      }
      // ileri: A_q(m) = log Σ_p α_{q−1}(p) γ_q(m, p)
      const la = Array.from(tm.prev, (x) => (x > 0 ? Math.log(x) : -Infinity));
      if (la.every((x) => x === -Infinity)) la.fill(0);
      for (let q = 0; q < n - 1; q++) {
        for (let m = 0; m < 8; m++) {
          for (let p = 0; p < 8; p++) tmp[p] = (q === 0 ? la[p] : A[(q - 1) * 8 + p]) + Ft8Demod.gamma(T, q * 32, m, p);
          A[q * 8 + m] = lse(tmp);
        }
        normalize(A, q * 8);
      }
      // geri: son veri sembolünü, ardından gelen Costas sembolünün (ton COSTAS[0]) gözlemi bağlar
      const oc = (n - 1) * 32;
      for (let p = 0; p < 8; p++) B[(n - 2) * 8 + p] = Ft8Demod.gamma(T, oc, COSTAS[0], p);
      normalize(B, (n - 2) * 8);
      for (let q = n - 2; q > 0; q--) {
        for (let p = 0; p < 8; p++) {
          for (let m = 0; m < 8; m++) tmp[m] = Ft8Demod.gamma(T, q * 32, m, p) + B[q * 8 + m];
          B[(q - 1) * 8 + p] = lse(tmp);
        }
        normalize(B, (q - 1) * 8);
      }
      for (let q = 0; q < n - 1; q++) {
        const P = post[q * N + s];
        for (let m = 0; m < 8; m++) P[m] = A[q * 8 + m] + B[q * 8 + m];
        const z = lse(P);
        for (let m = 0; m < 8; m++) P[m] = Math.exp(P[m] - z);
      }
    }
    // sonsallarla model güncellemesi (sembol sırasıyla) ve bit LLR'leri
    this.cache = [];
    this.cacheFirst = first;
    const lp = new Float64Array(8);
    for (let q = 0; q < n - 1; q++) {
      const soft = new Float32Array(3 * N);
      let margin = Infinity;
      let snr = 0;
      for (let s = 0; s < N; s++) {
        const P = post[q * N + s];
        for (let m = 0; m < 8; m++) lp[m] = Math.log(Math.max(P[m], 1e-300));
        for (let b = 0; b < 3; b++) {
          const mask = 4 >> b;
          let s0 = 0;
          let s1 = 0;
          for (let m = 0; m < 8; m++) {
            if (TONE_BITS[m] & mask) s1 += P[m];
            else s0 += P[m];
          }
          const l = Math.log(Math.max(s0, 1e-300)) - Math.log(Math.max(s1, 1e-300));
          soft[3 * s + b] = Math.max(-CLAMP_LLR, Math.min(CLAMP_LLR, l));
        }
        let best = 0;
        for (let m = 1; m < 8; m++) if (P[m] > P[best]) best = m;
        let second = 0;
        for (let m = 0; m < 8; m++) if (m !== best && P[m] > second) second = P[m];
        margin = Math.min(margin, 10 * Math.log10(P[best] / Math.max(second, 1e-30)));
        const tm = this.models[s];
        snr += (10 * Math.log10(Math.max(tm.signal(), 1e-20) / Math.max(tm.floor, 1e-20) / 8)) / N;
        tm.update(energies[q * N + s], P, this.rho, 0.05);
      }
      this.cache.push({ soft, margin: Math.min(margin, 99), snr });
    }
    return true;
  }

  read(store, j) {
    const { block } = this.where(j);
    if (block >= 0) {
      if (j === block && !this.costas(store, block)) return null;
      return {};
    }
    const { first, last } = this.dataBlock(j);
    if (j === first && !this.decodeBlock(store, first, last)) return null;
    return this.cache[j - this.cacheFirst];
  }
}
