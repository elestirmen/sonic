// JANUS — frekans atlamalı ikili FSK (FH-BFSK), NATO STANAG 4748 / ANEP-87 çizgisinde (Mod 5).
//
// JANUS, su altı akustik haberleşmesi için NATO'nun ilk sayısal standardıdır (Potter vd. 2014,
// UComms; STANAG 4748). Bant 13 alt banda bölünür, her alt bantta iki ton vardır (13 ton çifti,
// 26 ton). Her kodlu bit bir "çip"tir: çipin hangi çiftte çalınacağını frekans atlama dizisi,
// çiftin hangi tonunun çalınacağını bitin kendisi belirler (ikili FSK). Bitler K = 9, oran 1/2
// evrişimli kodla (üreteçler 753/561, bkz. conv.js) korunup serpiştirilir; paket sabit, 32 çiplik
// bir önsözle başlar. Özgün parametreler fc ≈ 11,52 kHz, B ≈ 4,16 kHz, ≈ 160 çip/sn (ton aralığı
// B/26 = 160 Hz = 1/çip süresi). Alıcı ton enerjilerini evresiz (non-coherent) karşılaştırır;
// taşıyıcı evresi, kanal kestirimi ve eşitleyici gerekmez. Hız düşüktür, ama tek bir çipin
// kaybı (sönüm, yankı, darbe) kod ve serpiştirme sayesinde tek tük bir bit hatasıdır.
//
// Havaya uyarlama. Odada asıl düşman yankıdır (RT60 0,4–1,2 s; su altında da benzer bir sorun):
// bir ton susunca yankısı yüzlerce ms sürer ve aynı çift yeniden kullanılınca öbür tonun enerjisine
// karışır. Atlama dizisi h(k) = 5k mod 13 (GF(13)'te doğrusal) her 13 ardışık çipte her çifti tam
// bir kez kullanır: bir çift ancak 12 çip sonra yeniden duyulur ("yankı yaşı" 12 · Tc; MFSK'nin
// ton kümeleriyle aynı fikir, bkz. profiles.js). Ardışık çipler 5 çift (bandın ~%40'ı) uzakta:
// bir önceki çipin yankısı çözülen çifte sızmaz ve çiftler bandın tamamına yayılır (frekans
// çeşitlemesi). Çift içindeki iki ton bitişiktir: hoparlörün/odanın frekans eğimi iki tonu
// benzer etkiler, karar eğilmez. Çip süresi 10–20 ms (yankı yaşı 120–240 ms); ton aralığı
// 2,3–4 / Tc: Hann penceresinde komşu ton sıfırların yakınına düşer, ±150 ppm saat farkı ve
// hareketin Doppler'i (≤ 20 Hz) aralığın küçük bir kesridir. Çipler arası 2 ms'lik yükseltilmiş
// kosinüs geçişi tık sesini önler; iki çipin ağırlıkları toplamı 1 olduğundan tepe genliği aşılmaz.
//
// Alıcı. Her çip süresinde (pencere) 26 tonun Hann pencereli Goertzel enerjisi hesaplanır.
//   · Gürültü tabanı: 6–10 çip önce kullanılmış çiftlerin o an çalınmamış (sessiz) tonları.
//   · Yankı tahmini: m çip önce çalınan tonun bugünkü enerjisinin o anki enerjisine oranı c(m)
//     boştaki çiftlerden ölçülür (m = 6–10) ve üstel olarak 13 (+ kuyruk) çipe uzatılır. Etkin
//     çiftin her tonundaki girişim Ia, Ib = gürültü + c(13) × o tonun 13 çip önceki enerjisi:
//     13 çip önce hangi ton çalındıysa yankı onda beklenir (karar gerektirmez).
//   · Yankı kuyruğunu toplama: çip susunca kendi yankısı da aynı tonda sürer; bu, oda dürtü
//     yanıtının başka bir kesiminden gelen, bağımsız sönümlü bir kopyadır. Çipin çifti sonraki
//     K çip boyunca (≈ 180 ms, en çok 10 çip; çift 13 çip sonra yeniden çalar) okunur ve her
//     gecikme ayrı bir çeşitleme dalı sayılır (kare-yasa birleştirme; Proakis): uzak ve yankılı
//     odada toplanan enerji ve çeşitleme derecesi artar; yankısız odada dalların beklenen sinyali
//     sıfıra yakın ölçülür, ağırlıkları da sıfıra iner.
//   · LLR (Rayleigh sönümlü dal, kare-yasa): Es dalın beklenen sinyal enerjisi olmak üzere
//       L = Ea·wa − Eb·wb + ln(Ia(Es + Ib) / ((Es + Ia)Ib)),  w = Es / (I(I + Es));
//     dalların L'leri toplanır. Viterbi yalnız göreli değerlere bakar, ama RS silintilerini
//     seçen bayt güveni gerçek ölçekli LLR ister; bu yüzden Es ve I sinyalden kestirilir.
//   · Zamanlama: etkin çiftin çeyrek çip erken ve geç pencerelerdeki enerji farkı. Yankı, geç
//     pencereye kalıcı bir eğilim verir (enerjinin ağırlık merkezi geç kayar, oysa hata oranı en
//     düşük doğrudan yolda); bu yüzden ilk 96 çipte zamanlama senkrondaki gibi tutulur, farkın
//     o dengesi ölçülür ve sonra yalnız bu dengeden sapma izlenir (ikinci dereceden döngü;
//     kayma hızı saat farkı + hareket sınırında, 6·10⁻⁴).
//
// Paket: 32 çip önsöz · başlık (7 bayt, K = 9 → 128 çip) · veri. Önsöz bilinen bir dizidir;
// burada senkronu chirp yaptığı için önsöz, kestiricilerin (gürültü, yankı, sinyal düzeyi)
// başlıktan önce oturmasına ve senkron chirp'inin yankısının sönmesine yarar. Başlık ve veri
// ayrı ayrı serpiştirilir: kodlu bit i, bölümünün (i · q) mod N. çipine düşer; q, N/φ'ye (altın
// oran) yakın, N ile aralarında asal bir asal sayıdır. Komşu kodlu bitler en az 13 çip uzakta
// ve farklı çiftlerdedir.
//
// Özgün JANUS'tan sapmalar (uyumluluk iddia edilmez; bir JANUS modemi bu sinyali çözemez):
//   1. Bant, çip süresi ve ton aralığı havaya göre: 1,8–8,1 / 11,3–17,1 / 17,5–20,4 kHz,
//      10–20 ms çip, aralık 1/Tc yerine 2,3–4/Tc (Hann penceresi ve yankı yaşı için).
//   2. Atlama dizisi standarttaki dizinin kendisi değil; aynı amaçla (her 13 çipte her çift bir
//      kez) kurulmuş doğrusal h(k) = 5k mod 13.
//   3. Serpiştirici standarttakiyle aynı değil (asal adımlı, altın oran).
//   4. Önsözün 32 biti bizim seçtiğimiz dengeli bir dizidir (m-dizisi + 0); algılama ve zamanlama
//      önsözle değil, bandın ortak senkron chirp'iyle yapılır. Uyandırma tonları yok.
//   5. Çerçeve JANUS'un 64 bitlik temel paketi (CRC-8, sınıf/uygulama alanları) değil, Sonik'in
//      başlığı ve RS + CRC-32'li verisidir; iç kod aynı K = 9 koddur.
//   6. Alıcı (yankı tahminli LLR, kuyruk toplama, zamanlama döngüsü) bu uygulamanındır;
//      standart alıcıyı tanımlamaz.

import { hann } from '../dsp/filters.js';

const TWO_PI = 2 * Math.PI;
export const PAIRS = 13;
const TONES = 2 * PAIRS;
const HOP_STEP = 5; // ardışık çipler arası çift adımı (GF(13)'te çarpan)
/** 32 çiplik önsöz: 5 bitlik m-dizisi (x⁵ + x³ + 1) + 0; 16 sıfır, 16 bir. */
export const PREAMBLE = Uint8Array.from([
  0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0,
]);
const RAMP = 0.002; // çipler arası yükseltilmiş kosinüs geçişi (s)
const TAIL = 0.18; // çipin kendi yankısının toplandığı süre (s)
const MAX_TAIL = 10; // kuyruk dalı sınırı: çift 13 çip sonra yeniden çalar, zamanlama kayarsa sızmasın
const HIST = 64; // pencere geçmişi (≥ 26 + kuyruk)
const EL = 0.25; // erken/geç pencerelerin kayması (çip)
const REF_CHIPS = 96; // bu çipe kadar zamanlama sabit; erken/geç farkının yankı eğilimi ölçülür
const SLOPE = 2.2; // yankısız odada erken/geç farkının zaman hatasına eğimi (1/çip)
const KP = 0.05; // zamanlama döngüsü kazançları (çip başına)
const KI = 0.001;
const MAX_RATE = 6e-4; // en büyük gecikme değişim hızı: 300 ppm saat farkı + ~10 cm/sn hareket

const infoCache = new WeakMap();

/** { T: çip süresi (s), lo, hi: tonların kapladığı bant (Hz), codedBitRate: çip = kodlu bit/sn }. */
export function janusInfo(p) {
  let info = infoCache.get(p);
  if (!info) {
    info = {
      T: p.chipDur,
      lo: p.fLow - p.toneSpacing / 2,
      hi: p.fLow + (TONES - 0.5) * p.toneSpacing,
      codedBitRate: 1 / p.chipDur,
    };
    infoCache.set(p, info);
  }
  return info;
}

/** Önsöz + her kodlu bit için bir çip. */
export function janusSymbolCount(p, headerBits, payloadBits) {
  return PREAMBLE.length + headerBits + payloadBits;
}

/** k. çipin (paketin ilk önsöz çipinden sayılır) ton çifti. */
export const hopPair = (k) => (HOP_STEP * k) % PAIRS;

const toneFreq = (p, n) => p.fLow + n * p.toneSpacing;

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

function isPrime(n) {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
}

const steps = new Map();

/**
 * Serpiştirme adımı q: N/φ'ye en yakın asal; N ile aralarında asal (birebir eşleme) ve ne q ne
 * N − q 13'ün katı (komşu kodlu bitler farklı çiftlere düşsün). Altın oran, küçük katların
 * (2q, 3q, …) mod N'de birbirinden uzak kalmasını sağlar.
 */
function spreadStep(n) {
  let q = steps.get(n);
  if (q === undefined) {
    q = 1;
    const target = Math.round(n / 1.6180339887);
    search: for (let d = 0; d < n; d++) {
      for (const c of [target - d, target + d]) {
        if (c > 1 && c < n && isPrime(c) && gcd(c, n) === 1 && c % PAIRS !== 0 && (n - c) % PAIRS !== 0) {
          q = c;
          break search;
        }
      }
    }
    steps.set(n, q);
  }
  return q;
}

/** Kodlu bit i → bölümün (i · q) mod N. çipi. */
export function janusInterleave(bits) {
  const n = bits.length;
  const q = spreadStep(n);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[(i * q) % n] = bits[i];
  return out;
}

/** Çip sırasındaki LLR'ler → kodlu bit sırası. */
export function janusDeinterleave(values, n) {
  const q = spreadStep(n);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = values[(i * q) % n] || 0;
  return out;
}

const rise = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * x));

/**
 * Önsöz, başlık ve veri çiplerini out'a ekler. start: ilk çipin başı (kesirli örnek no). Fazlar
 * gerçek zamana göre hesaplanır; her örnekleme hızında aynı sinyal çıkar.
 */
export function renderJanus(out, start, headerBits, payloadBits, p, fs, amplitude) {
  const T = p.chipDur;
  const chips = new Uint8Array(PREAMBLE.length + headerBits.length + payloadBits.length);
  chips.set(PREAMBLE);
  chips.set(janusInterleave(headerBits), PREAMBLE.length);
  chips.set(janusInterleave(payloadBits), PREAMBLE.length + headerBits.length);
  const n = chips.length;
  const w = Float64Array.from(chips, (b, k) => TWO_PI * toneFreq(p, 2 * hopPair(k) + b));
  const first = Math.max(0, Math.ceil(start));
  const last = Math.min(out.length - 1, Math.floor(start + n * T * fs));
  for (let i = first; i <= last; i++) {
    const u = (i - start) / fs;
    const k = Math.min(n - 1, Math.floor(u / T));
    const x = u - k * T;
    // çip sınırının RAMP genişliğindeki çevresinde iki çip çapraz geçer (ağırlıklar toplamı 1)
    let a = 1;
    let other = -1;
    if (x < RAMP / 2 && k > 0) {
      a = rise(x / RAMP + 0.5);
      other = k - 1;
    } else if (x > T - RAMP / 2 && k < n - 1) {
      a = rise((T - x) / RAMP + 0.5);
      other = k + 1;
    }
    let s = a * Math.sin(w[k] * u);
    if (other >= 0) s += (1 - a) * Math.sin(w[other] * u);
    const edge = Math.min(u, n * T - u); // paketin başı ve sonu
    if (edge < RAMP) s *= rise(edge / RAMP);
    out[i] += amplitude * s;
  }
  return last + 1;
}

/** buf[from…] üzerinde win pencereli Goertzel: c = 2 cos(ω) frekansındaki enerji. */
function goertzel(buf, from, win, c) {
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < win.length; i++) {
    const s0 = buf[from + i] * win[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

/** Rayleigh sönümlü tek dalın kare-yasa LLR'si (log P(0)/P(1)); Ia, Ib: tonlardaki gürültü + yankı. */
function branchLlr(Ea, Eb, Ia, Ib, Es) {
  const wa = Es / (Ia * (Ia + Es));
  const wb = Es / (Ib * (Ib + Es));
  return Ea * wa - Eb * wb + Math.log((Ia * (Es + Ib)) / ((Es + Ia) * Ib));
}

/**
 * Tek paketin JANUS çözücüsü. i. pencere, i. çipin süresidir; read(j), j. çipin kararı için
 * j … j + K pencerelerini kullanır (kuyruk dalları), bu yüzden windowEnd(j) K çip ileriyi bekler.
 * Önsöz çipleri için {} döner (kestiriciler yine güncellenir).
 */
export class JanusDemod {
  constructor(p, fs, start) {
    this.p = p;
    this.start = start;
    this.Tn = p.chipDur * fs; // çip başına örnek
    this.Wn = Math.round(this.Tn);
    this.win = hann(this.Wn);
    this.d = Math.round(EL * this.Tn);
    this.span = this.Wn + 2 * this.d;
    this.buf = new Float32Array(this.span);
    this.coef = Float64Array.from({ length: TONES }, (_, n) => 2 * Math.cos((TWO_PI * toneFreq(p, n)) / fs));
    this.K = Math.max(0, Math.min(MAX_TAIL, Math.round(TAIL / p.chipDur)));
    this.hist = Array.from({ length: HIST }, () => new Float64Array(TONES)); // pencere başına 26 enerji
    this.noiseAt = new Float64Array(HIST);
    this.computed = -1; // hesaplanan son pencere
    this.noise = 0;
    this.cNum = new Float64Array(11); // yankı profili c(m) = cNum[m] / cDen[m], m = 6…10
    this.cDen = new Float64Array(11);
    this.rNum = new Float64Array(this.K + 1); // kuyruk dalının sinyali / doğrudan dalın sinyali
    this.rDen = new Float64Array(this.K + 1);
    this.ratios = new Float64Array(2 * (this.K + 1));
    this.Es = new Float64Array(PAIRS); // çift başına doğrudan dalın sinyal enerjisi
    this.seen = new Uint8Array(PAIRS);
    this.offset = 0; // zaman düzeltmesi (örnek)
    this.rate = 0; // çip başına kayma (örnek)
    this.refSum = 0;
    this.refN = 0;
    this.maxRate = MAX_RATE * this.Tn;
    this.bitsPerSymbol = 1;
  }

  /** i. pencerenin (erken/geç paylarıyla) okunacağı ilk örnek. */
  from(i) {
    return Math.round(this.start + (i + 0.5) * this.Tn + this.offset - this.Wn / 2) - this.d;
  }

  windowEnd(j) {
    return this.from(j + this.K) + this.span;
  }

  deinterleave(flat, n) {
    return janusDeinterleave(flat, n);
  }

  /** i. pencere: 26 tonun enerjisi, gürültü tabanı, yankı profili ve zamanlama döngüsü. */
  slot(store, i) {
    if (!store.read(this.from(i), this.buf)) return false;
    const { buf, win, coef, d, hist } = this;
    const E = hist[i % HIST];
    for (let n = 0; n < TONES; n++) E[n] = goertzel(buf, d, win, coef[n]);
    // Gürültü tabanı: 6–10 çip önce kullanılmış beş çiftin o an çalınmamış tonu (ortanca;
    // 5 üstel değişkenin ortancasının beklentisi 0,783 × ortalama).
    const quiet = [];
    for (let m = 7; m <= 11; m++) {
      const q = hopPair(i - m + 13 * PAIRS);
      if (i - m >= 0) {
        const P = hist[(i - m) % HIST];
        quiet.push(P[2 * q] <= P[2 * q + 1] ? E[2 * q] : E[2 * q + 1]);
      } else quiet.push(Math.min(E[2 * q], E[2 * q + 1])); // henüz çalınmamış çift
    }
    quiet.sort((x, y) => x - y);
    const lam = i < PREAMBLE.length ? 0.3 : 0.1;
    this.noise = i === 0 ? quiet[2] / 0.783 : (1 - lam) * this.noise + (lam * quiet[2]) / 0.783;
    const N = Math.max(this.noise, 1e-20);
    this.noiseAt[i % HIST] = N;
    // Yankı profili: m çip önce çalınan (o an güçlü olan) tonun bugünkü fazla enerjisi / o anki enerjisi.
    for (let m = 6; m <= 10; m++) {
      if (i - m < 0) continue;
      const q = hopPair(i - m + 13 * PAIRS);
      const P = hist[(i - m) % HIST];
      const loud = P[2 * q] > P[2 * q + 1] ? 2 * q : 2 * q + 1;
      this.cNum[m] = 0.98 * this.cNum[m] + (E[loud] - N);
      this.cDen[m] = 0.98 * this.cDen[m] + P[loud];
    }
    // Zamanlama: etkin çiftin çeyrek çip erken ve geç pencerelerdeki enerji farkı, yeterince
    // güçlü çiplerde. İlk REF_CHIPS çipte farkın dengesi (yankının eğilimi) ölçülür.
    const a = 2 * hopPair(i);
    if (E[a] + E[a + 1] > 8 * N) {
      const early = goertzel(buf, 0, win, coef[a]) + goertzel(buf, 0, win, coef[a + 1]);
      const late = goertzel(buf, 2 * d, win, coef[a]) + goertzel(buf, 2 * d, win, coef[a + 1]);
      const e = (late - early) / (late + early);
      if (i < REF_CHIPS) {
        this.refSum += e;
        this.refN++;
      } else {
        const err = ((e - this.refSum / Math.max(1, this.refN)) / SLOPE) * this.Tn; // örnek; geç gelen → +
        this.offset += KP * err;
        this.rate = Math.max(-this.maxRate, Math.min(this.maxRate, this.rate + KI * err));
      }
    }
    this.offset += this.rate;
    this.computed = i;
    return true;
  }

  /** Aynı tonun 13 + k ve 26 + k çip sonraki yankı oranları (k = 0…K): c(6…10)'dan üstel uzatma. */
  echoRatios() {
    const c10 = this.cNum[10] / (this.cDen[10] || 1);
    const c6 = this.cNum[6] / (this.cDen[6] || 1);
    const r = this.ratios;
    r.fill(0);
    if (!(c10 > 0)) return r;
    const g = c6 > c10 ? Math.max(0.2, Math.min(0.99, (c10 / c6) ** 0.25)) : 0.99;
    for (let k = 0; k <= this.K; k++) {
      r[k] = c10 * g ** (3 + k);
      r[this.K + 1 + k] = c10 * g ** (16 + k);
    }
    return r;
  }

  read(store, j) {
    while (this.computed < j + this.K) if (!this.slot(store, this.computed + 1)) return null;
    const { hist, K } = this;
    const p = hopPair(j);
    const a = 2 * p;
    const b = a + 1;
    // Girişim: gürültü + aynı tonun 13 ve 26 çip önceki kullanımlarının yankısı.
    const prev = j >= 13 ? hist[(j - 13) % HIST] : null;
    const prev2 = j >= 26 ? hist[(j - 26) % HIST] : null;
    const c = this.echoRatios();
    const I = (t, k) => {
      let v = this.noiseAt[(j + k) % HIST];
      if (prev) v += c[k] * prev[t];
      if (prev2) v += c[K + 1 + k] * prev2[t];
      return v;
    };
    const E0 = hist[j % HIST];
    const Ia0 = I(a, 0);
    const Ib0 = I(b, 0);
    const est = Math.max(0, E0[a] + E0[b] - Ia0 - Ib0); // karar gerektirmez: sinyal iki tondan birinde
    const Es0 = this.seen[p] ? this.Es[p] : Math.max(est, 1e-3 * (Ia0 + Ib0));
    let llr = branchLlr(E0[a], E0[b], Ia0, Ib0, Es0);
    // kuyruk dalları: aynı çiftin sonraki K penceresi
    for (let k = 1; k <= K; k++) {
      const Ek = hist[(j + k) % HIST];
      const Ia = I(a, k);
      const Ib = I(b, k);
      const r = Math.max(0, Math.min(2, this.rNum[k] / (this.rDen[k] || 1)));
      this.rNum[k] = 0.99 * this.rNum[k] + (Ek[a] + Ek[b] - Ia - Ib);
      this.rDen[k] = 0.99 * this.rDen[k] + est;
      if (r * Es0 > 0) llr += branchLlr(Ek[a], Ek[b], Ia, Ib, r * Es0);
    }
    this.Es[p] = this.seen[p] ? 0.7 * this.Es[p] + 0.3 * est : est;
    this.seen[p] = 1;
    if (j < PREAMBLE.length) return {};
    const N = this.noiseAt[j % HIST];
    // SNR: ton kutusundaki sinyal/gürültü, 26 tonun bandına (Hann ENBW = 1,5 / Tc) indirgenmiş
    const snr = 10 * Math.log10(Es0 / N + 1e-9) - 10 * Math.log10((TONES * this.p.toneSpacing * this.p.chipDur) / 1.5);
    return { soft: Float32Array.of(llr), margin: 4.343 * Math.abs(llr), snr };
  }
}
