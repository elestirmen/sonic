// DSSS — doğrudan dizili yayılı spektrum, diferansiyel BPSK ve RAKE alıcı (Mod 4).
//
// Klasik DSSS (Proakis ve Salehi 2008) ve IEEE 802.11-1997'nin DSSS fiziksel katmanı (madde 15:
// 11 çipli Barker dizisi, 1 Mbit/sn'de DBPSK) çizgisinde. Her iç kodlu bit bir semboldür: N çiplik
// yayma kesimi bitin işaretiyle çarpılır, çipler fc taşıyıcısında BPSK'dir. Hızlı profillerde kesim
// 802.11'deki gibi her bitte aynı Barker-11 dizisidir (kısa kod); Normal ve Sağlam'da ise bit başına
// 31 ya da 63 çip, PRBS-15 m-dizisinin (periyot 32767) ardışık kesimleridir (uzun kod; aşağıya bkz.).
// Çip darbesi kök yükseltilmiş kosinüstür (RRC, β = 0,5), çip hızı Rc = B / (1 + β): spektrum
// fLow–fHigh bandında kalır (std'de 4000 çip/sn). Bitler diferansiyel kodlanır: 1, bir önceki sembole
// göre π faz farkıdır; alıcının bilmediği taşıyıcı fazı ve her yolun fazı farkta düşer.
//
// Alıcı her bit için sesi temel banda indirir, RRC uyumlu süzgeçten yarım çip aralıkla örnekler ve
// bitin kesimiyle bir gecikme penceresi boyunca ilişkilendirir: c_n[L] (L yarım çip; pencere ana
// yolun en çok 2 ms öncesinden 8 ms sonrasına, bir bitten kısa). |c|²'nin ortalaması gecikme (güç)
// profilidir; ayrı gelen yankı yolları ayrı tepeler verir. RAKE (Price ve Green 1958): en güçlü en
// çok 4 yol birer koldur, kolların ölçümleri toplanır. Kol başına LLR, fazı bilinmeyen iki ardışık
// sembolün tam olabilirlik oranıdır (ln I0 farkı); düşük SNR'de bu, ağırlıklı diferansiyel birleştirmeye
// Σ_f w_f · Re{c_f[n] · conj(c_f[n−1])}, w_f ∝ S_f / σ⁴ indirgenir. Gürültü + girişim varyansı σ²
// profilin ortancasıdır; LLR'ler yaklaşık gerçek olabilirlik oranlarıdır (RS silinti güvenleri için).
//
// Oda yankısı (RT60 0,4–1,2 s) bir bitten (3–16 ms) çok uzundur. Pencereye düşmeyen geç yankı önceki
// bitlerin verisini taşıyan bir öz girişimdir; DBPSK'de ona karşı tek savunma işlem kazancı N'dir.
// Gücü dizinin kısmi (aperiyodik) ilintilerine bağlıdır: kısa kodda periyoda hizalı gecikmeler tam
// ilintiyle (E_geç / N), hizasızlar kısmi ilintilerle gelir. m-dizisinin döngüsel ilintisi ideal (−1)
// olsa da veri işareti değişince devreye giren kısmi ilintileri √N mertebesindedir; kısa m-dizisinde
// girişim bu yüzden ~2·E_geç / N'ye çıkar (E_geç: geç yankının doğrudan yola enerji oranı). Uzun kodda
// her bit başka bir kesim taşır, yankı rastgele bir diziyle ilişkilenir: ~E_geç / N. Barker-11'in
// kısmi ilintileri ≤ 1 olduğundan onda kısa kod yeter. (Simülatörde çok uzak salonda, DRR −12 dB,
// N = 31: bit başı SINR ~0 → ~1,7 dB, paket başarısı %10 → %100.) Alıcı yankıyı ayrıca üç yerde
// hesaba katar: σ² tabanı girişimi de içerir (LLR ölçeği doğru kalır); kollar güç profilinden değil,
// o anki kararla tutarlı "diferansiyel" profilden seçilir (katlanan yankının gecikme başına sabit bir
// girişim deseni vardır, güç profilinde sahte tepeler yapar); başvuru bitleri sözde rastgeledir.
//
// Zamanlama: başvuru bitlerinin diferansiyel profilinin tepesi (parabolik inceltmeyle) ana yoldur;
// sonra ana kolda ±½ çiplik erken-geç güç ayırıcılı, ikinci dereceden bir gecikme kilitli döngü
// (DLL, Spilker 1963) izler, kazancı ölçülen SNR'ye göre ayarlanır. Saat farkı ve hareket gecikmeyi
// paket boyunca çiplerce kaydırır (150 ppm → 10 s'de 6 çip). Aynı zaman ölçeklenmesi taşıyıcıda bit
// başı bir faz dönmesi (−2π·fc·δ) yapar; karar yönlendirmeli izlenir, fiziksel sınırla kırpılır, hızın
// ilk değeri de ondan gelir. Başka bir yol belirgin biçimde güçlenirse ana yol oraya taşınır.
//
// Paket: R bilinen başvuru biti (≥ 0,1 s ve ≥ 8 bit) · başlık · veri. Başlık ve veri ayrı ayrı
// serpiştirilir (dolgusuz satır-sütun, D ≈ √n satır).
//
// Özgün yöntemden sapmalar:
//  - Ses bandında 1,9–4 kçip/sn (802.11: 11 Mçip/sn, 2,4 GHz).
//  - 802.11 yalnız kısa Barker-11 kullanır. Normal ve Sağlam'da daha çok işlem kazancı (31 ve 63 çip)
//    ve yukarıdaki nedenle uzun kod: PN periyodu bitten çok uzun (IS-95 ters bağlantısındaki uzun kod
//    gibi); 802.11'e benzeyen yalnız Hızlı profillerdir.
//  - Bitler K = 7 evrişimli kod + RS ile korunur ve serpiştirilir (802.11 DSSS'de kanal kodu yoktur).
//  - Önsöz: 802.11'in 128 bitlik SYNC + SFD alanı yerine ortak senkron chirp'i ve kısa bir sözde
//    rastgele DBPSK başvurusu.
//  - Darbe RRC'dir (802.11 yalnız spektrum maskesi tanımlar). Tepe/RMS'i düşürmek için temel bant
//    1,25 · RMS'te kırpılır (bozulma ≈ −30 dB, ses gücü +1,2 dB); yine de sabit zarflı CSS'ten ~2 dB
//    daha tepelidir.
//  - 2 Mbit/sn DQPSK ve 802.11b CCK kademeleri yok.
//  - Kollar diferansiyel (evre uyumsuz) birleştirilir: ağırlıklar kestirilen kol güçlerinden gelir,
//    faz başvurusu bir önceki semboldür. Kanal fazını kestiren koherent RAKE'e göre düşük SNR'de
//    birkaç dB kaybettirir, karşılığında hareket ve Doppler'e duyarsızdır.

import { RX_TABLE, TX_TABLE, TX_TAPS, rc, rxKernel, txTable } from '../dsp/pulse.js';

const TWO_PI = 2 * Math.PI;
const ROLLOFF = 0.5; // kök yükseltilmiş kosinüs (RRC) yuvarlanma katsayısı
const CLIP = 1.25; // temel bant genliği, RMS'in bu katında kırpılır (tepe/RMS 1,46 → 1,25)
const RAMP = 0.001; // paketin başında ve sonunda yumuşak geçiş (s)
const REF_DUR = 0.1; // başvuru bitlerinin en kısa süresi (s)
const REF_MIN = 8; // en az başvuru biti
const PRE_WINDOW = 0.002; // ana yoldan önceki gecikme penceresi (s): gürültü tabanı, ana yoldan zayıf erken yollar
const DELAY_WINDOW = 0.008; // RAKE gecikme penceresi, ana yoldan sonra (s)
const MAX_FINGERS = 4;
const FINGER_REL = 0.1; // kol, ana yolun gücünün en az bu oranı olmalı
const FINGER_Z = 4; // kol, gürültü tabanının kestirim sapmasının en az bu katı üstünde olmalı
const PDP_DUR = 0.25; // gecikme profili (PDP) ortalamasının zaman sabiti (s)
const PHASE_DUR = 0.12; // bit başı faz dönmesi kestiriminin zaman sabiti (s)
const MAX_RATE = 6e-4; // en büyük gecikme değişim hızı: 300 ppm saat farkı + ~10 cm/sn hareket
const TRACK = 2e-4; // izleyicinin beklediği gecikme değişimi (s/s), kazancı belirler
const A_MIN = 0.03;
const A_MAX = 0.5;
const MAX_DEPTH = 24; // serpiştirici satır sayısı sınırı

// Barker-11 (IEEE 802.11-1997 DSSS PHY).
const BARKER11 = [1, -1, 1, 1, -1, 1, 1, 1, -1, -1, -1];
// En büyük uzunluklu diziler (m-dizileri), ilkel üç terimli x^n + x^k + 1 → a[t+n] = a[t+k] ⊕ a[t].
// prbs15: x^15 + x^14 + 1 (ITU-T O.150 PRBS-15), periyot 32767.
const M_POLY = { m31: [5, 3], m63: [6, 5], m127: [7, 6], prbs15: [15, 14] };

/** Yayma dizisi (±1), bir periyot. name: 'barker11' | 'm31' | 'm63' | 'm127' | 'prbs15'. */
export function spreadingCode(name) {
  if (name === 'barker11') return Int8Array.from(BARKER11);
  const poly = M_POLY[name];
  if (!poly) throw new Error(`dsss: bilinmeyen dizi ${name}`);
  const [n, k] = poly;
  const len = (1 << n) - 1;
  const a = new Uint8Array(len + n);
  a[0] = 1;
  for (let t = 0; t + n < a.length; t++) a[t + n] = a[t + k] ^ a[t];
  return Int8Array.from(a.subarray(0, len), (b) => 1 - 2 * b);
}

// Başvuru bitleri: bilinen sözde rastgele desen (m127'nin ilk bitleri). Sabit desen (hep 0)
// sinyali N çip periyotlu yapar; o zaman oda yankısının her gecikmesi, periyoda katlanıp bitten
// bite eş fazlı toplanır ve gecikme profilinde sahte tepeler doğurur (RT60 1 s'de ana yoldan
// güçlü). Rastgele desende katlanan yankının işareti bitten bite değişir, ortalamada söner.
const REF_BITS = Uint8Array.from(spreadingCode('m127'), (c) => (1 - c) / 2);
const refBit = (j) => (j > 0 ? REF_BITS[j % REF_BITS.length] : 0);

// ln I0(x) için Abramowitz ve Stegun 9.8.1–9.8.2 polinomları (bağıl hata < 2·10⁻⁷).
const I0_SMALL = [1, 3.5156229, 3.0899424, 1.2067492, 0.2659732, 0.0360768, 0.0045813];
const I0_LARGE = [
  0.39894228, 0.01328592, 0.00225319, -0.00157565, 0.00916281, -0.02057706, 0.02635537, -0.01647633, 0.00392377,
];

function horner(c, t) {
  let v = 0;
  for (let i = c.length - 1; i >= 0; i--) v = v * t + c[i];
  return v;
}

/** ln I0(x), x ≥ 0. */
function lnI0(x) {
  if (x < 3.75) return Math.log(horner(I0_SMALL, (x / 3.75) ** 2));
  return x - 0.5 * Math.log(x) + Math.log(horner(I0_LARGE, 3.75 / x));
}

const infoCache = new WeakMap();

/**
 * Profil bilgisi: { T, lo, hi, codedBitRate } ve iç ayrıntılar (dizi, çip hızı, taşıyıcı).
 * Çip hızı, fLow–fHigh bandına RRC yuvarlanmasıyla sığan en büyük hızdır: Rc = B / (1 + β).
 * p.chips verilirse (uzun kod) bit başına o kadar çip, dizinin ardışık kesimlerinden alınır;
 * verilmezse her bit dizinin bir periyodudur (kısa kod, 802.11'deki gibi).
 */
export function dsssInfo(p) {
  let info = infoCache.get(p);
  if (!info) {
    const seq = spreadingCode(p.pn);
    const N = p.chips ?? seq.length;
    const period = seq.length;
    // dizi, kesimler periyot sınırında kopmasın diye N çip uzatılır
    const code = Int8Array.from({ length: period + N }, (_, i) => seq[i % period]);
    const beta = p.rolloff ?? ROLLOFF;
    const Rc = (p.fHigh - p.fLow) / (1 + beta);
    const T = N / Rc;
    info = {
      T,
      lo: p.fLow,
      hi: p.fHigh,
      codedBitRate: 1 / T,
      code,
      period,
      N,
      beta,
      Rc,
      fc: (p.fLow + p.fHigh) / 2,
      ref: Math.max(REF_MIN, Math.ceil(REF_DUR / T - 1e-9)),
    };
    infoCache.set(p, info);
  }
  return info;
}

/** j. bitin yayma kesimi (N çip). Kısa kodda hep aynı periyot, uzun kodda dizinin j. kesimi. */
export function bitCode(info, j) {
  const o = (j * info.N) % info.period;
  return info.code.subarray(o, o + info.N);
}

export function dsssSymbolCount(p, headerBits, payloadBits) {
  return dsssInfo(p).ref + headerBits + payloadBits;
}

const orders = new Map();

/**
 * Serpiştirme sırası (dolgu yok): n bit, D ≈ √n satırlı bir tabloya satır satır yazılır,
 * sütun sütun okunur; boş hücreler atlanır. order[t] = t. gönderilen bitin kodlu dizideki yeri.
 * Kodlu dizide komşu bitler D bit arayla gönderilir; D bitlik bir hata demeti (sönüm, konuşma
 * hecesi) Viterbi'ye ⌈n / D⌉ bit aralıklı tek tük hatalar olarak ulaşır. Diferansiyel algılamada
 * ardışık iki bit aynı gürültülü başvuruyu paylaşır; serpiştirme bu ilintiyi de dağıtır.
 */
export function interleaveOrder(n) {
  let order = orders.get(n);
  if (!order) {
    const D = Math.max(1, Math.min(MAX_DEPTH, Math.floor(Math.sqrt(n))));
    const C = Math.ceil(n / D);
    order = new Uint32Array(n);
    let t = 0;
    for (let j = 0; j < C; j++) {
      for (let b = 0; b < D; b++) {
        const i = b * C + j;
        if (i < n) order[t++] = i;
      }
    }
    if (orders.size > 64) orders.clear();
    orders.set(n, order);
  }
  return order;
}

/**
 * Veri bölümünü out'a ekler. start: ilk başvuru bitinin başı (kesirli örnek no).
 * headerBits / payloadBits: iç kodlu (serpiştirilmemiş) bitler.
 */
export function renderDsss(out, start, headerBits, payloadBits, p, fs, amplitude) {
  const info = dsssInfo(p);
  const { N, Rc, fc, beta, ref } = info;
  const count = ref + headerBits.length + payloadBits.length;
  // DBPSK: her kodlu bit, bir önceki sembole göre faz farkıdır (1 → π).
  const sym = new Int8Array(count);
  let s = 1;
  let j = 0;
  for (; j < ref; j++) {
    if (refBit(j)) s = -s;
    sym[j] = s;
  }
  for (const part of [headerBits, payloadBits]) {
    const order = interleaveOrder(part.length);
    for (let t = 0; t < part.length; t++, j++) {
      if (part[order[t]]) s = -s;
      sym[j] = s;
    }
  }
  const spc = fs / Rc; // çip başına örnek
  const table = txTable(beta);
  const lim = table.length - 1;
  const chips = count * N;
  const end = start + count * N * spc;
  const first = Math.max(0, Math.ceil(start));
  const last = Math.min(out.length - 1, Math.ceil(end) - 1);
  const rampN = RAMP * fs;
  const w = (TWO_PI * fc) / fs;
  const gain = amplitude / CLIP;
  let codeBit = 0;
  let code = bitCode(info, 0);
  for (let i = first; i <= last; i++) {
    const u = (i - start) / spc; // çip cinsinden zaman
    const m0 = Math.max(0, Math.ceil(u - 0.5 - TX_TAPS));
    const m1 = Math.min(chips - 1, Math.floor(u - 0.5 + TX_TAPS));
    let x = 0;
    for (let m = m0; m <= m1; m++) {
      const pos = (u - m - 0.5 + TX_TAPS) * TX_TABLE;
      const k = Math.floor(pos);
      if (k < 0 || k >= lim) continue; // kayan nokta: pencerenin tam ucu
      const h = table[k] + (pos - k) * (table[k + 1] - table[k]);
      const bit = (m / N) | 0;
      if (bit !== codeBit) code = bitCode(info, (codeBit = bit));
      x += sym[bit] * code[m - bit * N] * h;
    }
    if (x > CLIP) x = CLIP;
    else if (x < -CLIP) x = -CLIP;
    const edge = Math.min(i - start, end - i);
    const env = edge < rampN ? 0.5 - 0.5 * Math.cos((Math.PI * Math.max(0, edge)) / rampN) : 1;
    out[i] += gain * env * x * Math.cos(w * (i - start));
  }
  return last + 1;
}

function median(values, tmp) {
  tmp.set(values);
  tmp.sort();
  return tmp[tmp.length >> 1];
}

/**
 * Tek paketin DSSS çözücüsü. Her bit için: temel banda indirme, RRC uyumlu süzgeç (yarım çip
 * aralıklı), yayma dizisiyle gecikme penceresi boyunca ilinti → c[L]. |c[L]|²'nin ortalaması
 * gecikme profilidir (PDP); en güçlü yollar RAKE kollarıdır. Kolların diferansiyel LLR'leri toplanır
 * (bkz. detect). read(j): başvuru bitlerinde {} (kazanım), diğerlerinde { soft: [LLR], margin, snr }.
 */
export class DsssDemod {
  constructor(p, fs, start) {
    const info = dsssInfo(p);
    this.info = info;
    this.fs = fs;
    this.start = start;
    this.spc = fs / info.Rc;
    this.hs = this.spc / 2; // yarım çip (örnek)
    this.symN = info.T * fs;
    const N = info.N;
    const preChips = Math.min(Math.round(PRE_WINDOW * info.Rc), Math.floor((N - 1) / 4));
    const postChips = Math.max(1, Math.min(Math.round(DELAY_WINDOW * info.Rc), N - 1 - preChips));
    this.pre = 2 * preChips; // gecikme penceresi, yarım çip cinsinden
    this.nLag = 2 * (preChips + postChips) + 1;
    this.l0 = this.pre; // ana yolun indisi
    this.nOut = 2 * (N - 1) + this.nLag;
    this.kern = rxKernel(this.spc, info.beta);
    this.span = Math.ceil((this.nOut - 1) * this.hs + 2 * this.kern.half + 6);
    this.buf = new Float32Array(this.span);
    this.yr = new Float64Array(this.span);
    this.yi = new Float64Array(this.span);
    this.zr = new Float64Array(this.nOut);
    this.zi = new Float64Array(this.nOut);
    this.cr = new Float64Array(this.nLag);
    this.ci = new Float64Array(this.nLag);
    this.pr = new Float64Array(this.nLag); // bir önceki bitin ilintisi
    this.pi = new Float64Array(this.nLag);
    this.P = new Float64Array(this.nLag); // gecikme profili (|c|² ortalaması)
    this.D = new Float64Array(this.nLag); // tutarlı diferansiyel profil (bkz. detect)
    this.Vr = new Float64Array(this.nLag); // başvuru bitlerinde c · conj(c_önceki) toplamı
    this.Vi = new Float64Array(this.nLag);
    this.tmp = new Float64Array(this.nLag);
    this.wc = (TWO_PI * info.fc) / fs;
    this.mu = Math.min(0.5, info.T / PDP_DUR);
    this.muPhase = Math.min(0.5, info.T / PHASE_DUR);
    this.offset = 0;
    this.rate = 0;
    this.maxRate = MAX_RATE * this.symN;
    this.maxPhase = TWO_PI * info.fc * MAX_RATE * info.T; // bit başı faz dönmesinin sınırı
    this.accR = 0; // faz dönmesi biriktiricisi
    this.accI = 0;
    this.phase = 0;
    this.noise = 0;
    this.fingers = [];
    this.moves = 0; // ana yol değişimi sayısı (tanı için)
    // Erken-geç ayırıcının eğimi: |p(½ − ε)|² − |p(½ + ε)|² ≈ kd · ε · |p(0)|² (ε çip).
    const b = info.beta;
    const d = 1e-3;
    this.p5 = rc(0.5, b);
    this.kd = (-4 * this.p5 * (rc(0.5 + d, b) - rc(0.5 - d, b))) / (2 * d);
    this.q = (TRACK * info.T * info.Rc) ** 2; // bit başı beklenen gecikme değişimi (çip²)
    this.selfNoise = info.period > N ? 1 / N : 0; // uzun kodda yolun kendi yan tepe gücü / S
    this.bitsPerSymbol = 1;
  }

  symbolStart(j) {
    return this.start + j * this.symN + this.offset;
  }

  /** z[m]'nin mutlak konumu: bit başı + ½ çip + (m − pre) yarım çip; z[0] için. */
  firstOutput(j) {
    return this.symbolStart(j) + this.spc / 2 - this.pre * this.hs;
  }

  windowEnd(j) {
    // j = ref: kazanımdan sonra son başvuru biti yeni zamanlamayla yeniden ilişkilendirilir
    const a = Math.floor(this.firstOutput(j) - this.kern.half) - 1 + this.span;
    return j === this.info.ref ? Math.max(a, Math.floor(this.firstOutput(j - 1) - this.kern.half) - 1 + this.span) : a;
  }

  /** j. bitin ilintisini c'ye yazar (tüm gecikmeler). */
  correlate(store, j) {
    const u0 = this.firstOutput(j); // z[0]'ın mutlak konumu
    const { half, taps, table, diff } = this.kern;
    const from = Math.floor(u0 - half) - 1;
    if (!store.read(from, this.buf)) return false;
    const { span, buf, yr, yi, zr, zi, hs } = this;
    let cr = Math.cos(this.wc * from);
    let ci = -Math.sin(this.wc * from);
    const dr = Math.cos(this.wc);
    const di = -Math.sin(this.wc);
    for (let i = 0; i < span; i++) {
      yr[i] = buf[i] * cr;
      yi[i] = buf[i] * ci;
      const t = cr * dr - ci * di;
      ci = cr * di + ci * dr;
      cr = t;
    }
    // uyumlu süzgeç: kesirli konumda tablo ara değerlemesi (kesir her dokunuşta aynıdır)
    for (let m = 0; m < this.nOut; m++) {
      const v = u0 - from + m * hs - half;
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
      zr[m] = sr;
      zi[m] = si;
    }
    const { N } = this.info;
    const code = bitCode(this.info, j);
    const inv = 1 / N;
    for (let l = 0; l < this.nLag; l++) {
      let sr = 0;
      let si = 0;
      for (let k = 0, m = l; k < N; k++, m += 2) {
        if (code[k] > 0) {
          sr += zr[m];
          si += zi[m];
        } else {
          sr -= zr[m];
          si -= zi[m];
        }
      }
      this.cr[l] = sr * inv;
      this.ci[l] = si * inv;
    }
    return true;
  }

  swap() {
    let t = this.pr;
    this.pr = this.cr;
    this.cr = t;
    t = this.pi;
    this.pi = this.ci;
    this.ci = t;
  }

  /** Dizileri d gecikme adımı kaydırır (ana yol l0 + d'ye taşındığında). */
  shift(arr, d, fill) {
    const n = arr.length;
    if (d > 0) {
      for (let l = 0; l < n; l++) arr[l] = l + d < n ? arr[l + d] : fill;
    } else if (d < 0) {
      for (let l = n - 1; l >= 0; l--) arr[l] = l + d >= 0 ? arr[l + d] : fill;
    }
  }

  read(store, j) {
    const R = this.info.ref;
    if (j === R) {
      // son başvuru biti, kazanımın kaydırdığı zamanlamayla (ilk verinin diferansiyel başvurusu)
      if (!this.correlate(store, j - 1)) return null;
      this.swap();
    }
    if (!this.correlate(store, j)) return null;
    if (j < R) {
      // güç profili (P) ve bilinen bitlerle diferansiyel profil V = Σ c·conj(c_önceki)·s·s_önceki
      const { cr, ci, pr, pi, P, Vr, Vi } = this;
      const sg = 1 - 2 * refBit(j);
      for (let l = 0; l < this.nLag; l++) {
        P[l] += (cr[l] * cr[l] + ci[l] * ci[l]) / R;
        if (j > 0) {
          Vr[l] += sg * (cr[l] * pr[l] + ci[l] * pi[l]);
          Vi[l] += sg * (ci[l] * pr[l] - cr[l] * pi[l]);
        }
      }
      if (j === R - 1) this.acquire();
      this.swap();
      return {};
    }
    const res = this.detect();
    this.swap();
    return res;
  }

  /**
   * Başvuru bitlerinden sonra: gecikme profilinin tepesi ana yoldur. Zamanlama tepeye (parabolik
   * inceltmeyle kesirli) kaydırılır; faz dönmesi ve bununla gecikme değişim hızı başlatılır.
   */
  acquire() {
    const { P, Vr, Vi, nLag, l0 } = this;
    const R = this.info.ref;
    const noise = median(P, this.tmp);
    // Tepe, diferansiyel profilde aranır: E[V] = (R − 1)·|h(L)|²·e^{jφ}; gürültü ve başka
    // bitlerden katlanan yankı, işaretleri rastgele olduğundan ortalamada söner.
    const mag = this.tmp;
    for (let l = 0; l < nLag; l++) mag[l] = Math.hypot(Vr[l], Vi[l]) / (R - 1);
    let m = l0;
    for (let l = 0; l < nLag; l++) if (mag[l] > mag[m]) m = l;
    const S = mag[m];
    // gürültüde |V| ≈ σ²·√((R − 1)/2)/(R − 1)·√(π/2); tepe bunun belirgin üstünde olmalı
    if (S < FINGER_Z * noise * Math.sqrt(1 / (R - 1))) {
      this.noise = noise;
      return; // tepe yok: senkronun zamanlaması korunur
    }
    let frac = 0;
    if (m > 0 && m < nLag - 1) {
      const a = Math.sqrt(mag[m - 1]);
      const b = Math.sqrt(mag[m]);
      const c = Math.sqrt(mag[m + 1]);
      const den = a - 2 * b + c;
      if (den < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
    }
    const d = m - l0;
    this.offset += (d + frac) * this.hs;
    // Bit başı faz dönmesi φ ve gecikme değişim hızı. Taşıyıcı osilatörü yok: zaman ölçeklenmesi
    // (saat farkı, hareket) fazı ve çip zamanlamasını birlikte kaydırır, gecikme bit başına δ
    // artınca faz −2π·fc·δ döner. Böylece |φ| ≤ 2π·fc·MAX_RATE·T sınırlıdır; düşük SNR'de
    // ölçülen φ (başvurulardan, varyansı ≈ (2/γ + 1/γ²) / 2(R − 1)) bu öncül belirsizlikle
    // tartılır, sonra hız da ondan başlatılır.
    const g = S / noise;
    const phaseVar = (2 / g + 1 / (g * g)) / (2 * (R - 1));
    const prior = (this.maxPhase / 2) ** 2;
    const phi = Math.atan2(Vi[m], Vr[m]) * (prior / (prior + phaseVar));
    this.phase = Math.max(-this.maxPhase, Math.min(this.maxPhase, phi));
    const w = S / (S * noise + (noise * noise) / 2);
    this.accR = w * S * Math.cos(this.phase);
    this.accI = w * S * Math.sin(this.phase);
    const rate = (-this.phase / (TWO_PI * this.info.fc)) * this.fs;
    this.rate = Math.max(-this.maxRate, Math.min(this.maxRate, rate));
    const cph = Math.cos(this.phase);
    const sph = Math.sin(this.phase);
    for (let l = 0; l < nLag; l++) this.D[l] = (Vr[l] * cph + Vi[l] * sph) / (R - 1);
    this.shift(P, d, noise);
    this.shift(this.D, d, 0);
    this.noise = noise;
  }

  detect() {
    const { P, cr, ci, pr, pi, nLag, l0, mu } = this;
    for (let l = 0; l < nLag; l++) P[l] += mu * (cr[l] * cr[l] + ci[l] * ci[l] - P[l]);
    const noise = Math.max(1e-30, median(P, this.tmp));
    const Smain = Math.max(P[l0] - noise, 1e-3 * noise);
    // RAKE kolları: ana yol + tutarlı profilde (D) belirgin olan en güçlü yollar, en az 1 çip arayla.
    // Güç profili P, geç yankının girişimini de içerir: gecikme başına girişim gücü sabit bir
    // desendir (katlanan kuyruğun o gecikmedeki enerjisi) ve bazı gecikmelerde tabanın belirgin
    // üstüne çıkar. Böyle bir "kol" sinyal taşımaz, önceki bitlerin verisini ve sapma katar.
    // D = ⟨Re{c·conj(c_önceki)·e^{−jφ}}·karar⟩ ise yalnız o anki bitle tutarlı gücü, yani gerçek
    // yolu ölçer (girişimin işareti karardan bağımsızdır, ortalamada söner).
    const { D } = this;
    const Dmain = D[l0];
    const zmin = FINGER_Z * noise * Math.sqrt(mu / (2 * (2 - mu)));
    const fingers = [l0];
    const scale = Dmain > 0 ? Smain / Dmain : 0; // kararlardaki hata payı: D ≈ S·(1 − 2p)
    const power = [Smain];
    for (let f = 1; f < MAX_FINGERS && scale > 0; f++) {
      let best = -1;
      for (let l = 0; l < nLag; l++) {
        if (D[l] < zmin || D[l] < FINGER_REL * Dmain || (best >= 0 && D[l] <= D[best])) continue;
        let near = false;
        for (const x of fingers) if (Math.abs(x - l) < 2) near = true;
        if (!near) best = l;
      }
      if (best < 0) break;
      fingers.push(best);
      power.push(Math.max(1e-3 * noise, Math.min(P[best] - noise, D[best] * scale)));
    }
    // Kol başına tam olabilirlik: fazı bilinmeyen iki ardışık sembol (y0, y1) için
    //   LLR_f = ln I0(2√S·|y1 + y0|/σ²) − ln I0(2√S·|y1 − y0|/σ²),
    // y1 bit başı faz dönmesinden arındırılmış. Kollar bağımsız olduğundan LLR'ler toplanır.
    // Düşük SNR'de ln I0(x) ≈ x²/4 → LLR ≈ Σ (4·S_f/σ⁴)·Re{y1·conj(y0)}: doğrusal diferansiyel
    // RAKE birleştirmesi. Yüksek SNR'de doğrusal biçim (Gauss yaklaşımı) LLR'yi küçük gösterir.
    const cph = Math.cos(this.phase);
    const sph = Math.sin(this.phase);
    let llr = 0;
    let vr = 0;
    let vi = 0;
    let Stot = 0;
    for (let f = 0; f < fingers.length; f++) {
      const l = fingers[f];
      const S = power[f];
      const ar = cr[l] * cph + ci[l] * sph; // y1 · e^{−jφ}
      const ai = ci[l] * cph - cr[l] * sph;
      // Uzun kodda her yolun kısmi ilintileri bitten bite rastgeledir ve tüm gecikmelere ~S/N güç
      // taşır: tabanın (ortanca) içindedir ama kolun kendi gecikmesinde yoktur.
      const n = Math.max(0.5 * noise, noise - S * this.selfNoise);
      const g = (2 * Math.sqrt(S)) / n;
      llr += lnI0(g * Math.hypot(ar + pr[l], ai + pi[l])) - lnI0(g * Math.hypot(ar - pr[l], ai - pi[l]));
      const w = S / (S * n + (n * n) / 2);
      vr += w * (cr[l] * pr[l] + ci[l] * pi[l]);
      vi += w * (ci[l] * pr[l] - cr[l] * pi[l]);
      Stot += S;
    }
    const sgn = llr >= 0 ? 1 : -1;
    for (let l = 0; l < nLag; l++) {
      const x = (cr[l] * pr[l] + ci[l] * pi[l]) * cph + (ci[l] * pr[l] - cr[l] * pi[l]) * sph;
      D[l] += mu * (sgn * x - D[l]);
    }
    const mp = this.muPhase;
    this.accR += mp * (sgn * vr - this.accR);
    this.accI += mp * (sgn * vi - this.accI);
    this.phase = Math.max(-this.maxPhase, Math.min(this.maxPhase, Math.atan2(this.accI, this.accR)));
    // Erken-geç gecikme kilitli döngü (DLL), ana kolda ±½ çip: ikinci dereceden (alfa-beta).
    const E = cr[l0 - 1] * cr[l0 - 1] + ci[l0 - 1] * ci[l0 - 1];
    const L = cr[l0 + 1] * cr[l0 + 1] + ci[l0 + 1] * ci[l0 + 1];
    const e = Math.max(-0.5, Math.min(0.5, (L - E) / (this.kd * Smain)));
    const r = (2 * (2 * this.p5 * this.p5 * Smain * noise + noise * noise)) / (this.kd * Smain) ** 2;
    const alpha = Math.max(A_MIN, Math.min(A_MAX, Math.sqrt(this.q / r)));
    const beta = (alpha * alpha) / (2 - alpha) / 4;
    this.offset += alpha * e * this.spc;
    this.rate = Math.max(-this.maxRate, Math.min(this.maxRate, this.rate + beta * e * this.spc));
    this.offset += this.rate;
    // Ana yol değişimi: tutarlı profilde başka bir yol belirgin biçimde güçlüyse (doğrudan yol
    // kapandı, kazanım gürültü tepesine kilitlendi) zamanlama oraya taşınır; tam sayı gecikme
    // adımı olduğundan diziler kaydırılarak korunur.
    let top = l0;
    for (let l = 0; l < nLag; l++) if (D[l] > D[top]) top = l;
    if (top !== l0 && D[top] > 2 * Math.max(0, Dmain) && D[top] > 4 * zmin) {
      const d = top - l0;
      this.offset += d * this.hs;
      this.shift(P, d, noise);
      this.shift(D, d, 0);
      this.shift(cr, d, 0);
      this.shift(ci, d, 0);
      this.moves++;
    }
    this.noise = noise;
    this.fingers = fingers;
    const snr = 10 * Math.log10(Stot / noise) - 10 * Math.log10(this.info.N);
    return { soft: Float32Array.of(llr), margin: 10 * Math.log10(1 + Math.abs(llr)), snr };
  }

  deinterleave(flat, n) {
    const order = interleaveOrder(n);
    const out = new Float32Array(n);
    for (let t = 0; t < n; t++) out[order[t]] = flat[t] || 0;
    return out;
  }
}
