// DSSS — doğrudan dizili yayılı spektrum, DBPSK ve RAKE alıcı (Mod 4). Taslak; başlık yorumu sonra.

const TWO_PI = 2 * Math.PI;
const ROLLOFF = 0.5; // kök yükseltilmiş kosinüs (RRC) yuvarlanma katsayısı
const TX_TAPS = 5; // verici darbesinin yarı uzunluğu (çip)
const RX_TAPS = 3; // alıcı uyumlu süzgecinin yarı uzunluğu (çip): ISI −46 dB, uyumsuzluk kaybı 0,002 dB
const TAPER = 1; // darbe uçlarındaki kosinüs geçişi (çip)
const CLIP = 1.25; // temel bant genliği, RMS'in bu katında kırpılır (tepe/RMS 1,46 → 1,25)
const RAMP = 0.001; // paketin başında ve sonunda yumuşak geçiş (s)
const REF_DUR = 0.1; // başvuru bitlerinin en kısa süresi (s)
const REF_MIN = 8; // en az başvuru biti
const PRE_CHIPS = 4; // ana yoldan önceki gecikme penceresi (çip): gürültü tabanı ve erken yollar
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
const TABLE = 64; // alıcı çekirdek tablosunun örnek başına çözünürlüğü
const TX_TABLE = 256; // verici darbe tablosunun çip başına çözünürlüğü

// Barker-11 (IEEE 802.11-1997 DSSS PHY).
const BARKER11 = [1, -1, 1, 1, -1, 1, 1, 1, -1, -1, -1];
// En büyük uzunluklu diziler (m-dizileri): ilkel üç terimli x^n + x^k + 1 → a[t+n] = a[t+k] ⊕ a[t].
const M_POLY = { m15: [4, 3], m31: [5, 3], m63: [6, 5], m127: [7, 6] };

/** Yayma dizisi (±1). name: 'barker11' | 'm15' | 'm31' | 'm63' | 'm127'. */
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

/** Kök yükseltilmiş kosinüs darbesi (t çip cinsinden, birim enerji). */
function rrc(t, b) {
  if (Math.abs(t) < 1e-9) return 1 - b + (4 * b) / Math.PI;
  if (Math.abs(Math.abs(t) - 1 / (4 * b)) < 1e-9) {
    return (b / Math.SQRT2) * ((1 + 2 / Math.PI) * Math.sin(Math.PI / (4 * b)) + (1 - 2 / Math.PI) * Math.cos(Math.PI / (4 * b)));
  }
  return (Math.sin(Math.PI * t * (1 - b)) + 4 * b * t * Math.cos(Math.PI * t * (1 + b))) / (Math.PI * t * (1 - (4 * b * t) ** 2));
}

/** Kesilmiş RRC: uçları TAPER çip boyunca kosinüsle sıfıra iner. */
function pulse(t, b, taps) {
  const a = Math.abs(t);
  if (a >= taps) return 0;
  const w = a <= taps - TAPER ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (a - taps + TAPER)) / TAPER);
  return rrc(t, b) * w;
}

/** Yükseltilmiş kosinüs (RRC * RRC): alıcı çıkışındaki çip darbesi. */
function rc(t, b) {
  const s = Math.abs(t) < 1e-9 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
  const d = 1 - (2 * b * t) ** 2;
  return Math.abs(d) < 1e-9 ? (Math.PI / 4) * s : (s * Math.cos(Math.PI * b * t)) / d;
}

/** ln I0(x), x ≥ 0 (Abramowitz ve Stegun 9.8.1–9.8.2 polinomları). */
function lnI0(x) {
  if (x < 3.75) {
    const t = (x / 3.75) ** 2;
    return Math.log(1 + t * (3.5156229 + t * (3.0899424 + t * (1.2067492 + t * (0.2659732 + t * (0.0360768 + t * 0.0045813))))));
  }
  const t = 3.75 / x;
  const poly =
    0.39894228 +
    t * (0.01328592 + t * (0.00225319 + t * (-0.00157565 + t * (0.00916281 + t * (-0.02057706 + t * (0.02635537 + t * (-0.01647633 + t * 0.00392377)))))));
  return x - 0.5 * Math.log(x) + Math.log(poly);
}

const infoCache = new WeakMap();

/**
 * Profil bilgisi: { T, lo, hi, codedBitRate } ve iç ayrıntılar (dizi, çip hızı, taşıyıcı).
 * Çip hızı, fLow–fHigh bandına RRC yuvarlanmasıyla sığan en büyük hızdır: Rc = B / (1 + β).
 */
export function dsssInfo(p) {
  let info = infoCache.get(p);
  if (!info) {
    const code = spreadingCode(p.pn);
    const N = code.length;
    const beta = p.rolloff ?? ROLLOFF;
    const Rc = (p.fHigh - p.fLow) / (1 + beta);
    const T = N / Rc;
    info = {
      T,
      lo: p.fLow,
      hi: p.fHigh,
      codedBitRate: 1 / T,
      code,
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
function interleaveOrder(n) {
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

const txTables = new Map();

function txTable(beta) {
  let t = txTables.get(beta);
  if (!t) {
    const n = 2 * TX_TAPS * TX_TABLE + 2;
    t = new Float64Array(n);
    for (let i = 0; i < n; i++) t[i] = pulse(i / TX_TABLE - TX_TAPS, beta, TX_TAPS);
    txTables.set(beta, t);
  }
  return t;
}

/**
 * Veri bölümünü out'a ekler. start: ilk başvuru bitinin başı (kesirli örnek no).
 * headerBits / payloadBits: iç kodlu (serpiştirilmemiş) bitler.
 */
export function renderDsss(out, start, headerBits, payloadBits, p, fs, amplitude) {
  const { code, N, Rc, fc, beta, ref } = dsssInfo(p);
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

const rxKernels = new Map();

/** Alıcı uyumlu süzgeci (RRC), örnek cinsinden tablo; komşu farkları ara değerleme için. */
function rxKernel(spc, beta) {
  const key = `${spc.toFixed(6)}:${beta}`;
  let k = rxKernels.get(key);
  if (!k) {
    const half = Math.ceil(RX_TAPS * spc);
    const n = (2 * half + 3) * TABLE;
    const table = new Float64Array(n);
    const diff = new Float64Array(n);
    for (let i = 0; i < n; i++) table[i] = pulse((i / TABLE - half) / spc, beta, RX_TAPS) / spc;
    for (let i = 0; i + 1 < n; i++) diff[i] = table[i + 1] - table[i];
    k = { half, taps: 2 * half + 1, table, diff };
    rxKernels.set(key, k);
  }
  return k;
}

function median(values, tmp) {
  tmp.set(values);
  tmp.sort();
  return tmp[tmp.length >> 1];
}

/**
 * Tek paketin DSSS çözücüsü. Her bit için: temel banda indirme, RRC uyumlu süzgeç (yarım çip
 * aralıklı), yayma dizisiyle gecikme penceresi boyunca ilinti → c[L]. |c[L]|²'nin ortalaması
 * gecikme profilidir (PDP); en güçlü yollar RAKE kollarıdır. Kollar diferansiyel birleştirilir:
 * z = Σ w_f · Re{c_f[n] · conj(c_f[n−1]) · e^{−jφ}}.
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
    const preChips = Math.min(PRE_CHIPS, Math.floor((N - 1) / 4));
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
    this.accR = 0; // faz dönmesi biriktiricisi
    this.accI = 0;
    this.phase = 0;
    this.noise = 0;
    this.fingers = [];
    // Erken-geç ayırıcının eğimi: |p(½ − ε)|² − |p(½ + ε)|² ≈ kd · ε · |p(0)|² (ε çip).
    const b = info.beta;
    const d = 1e-3;
    this.p5 = rc(0.5, b);
    this.kd = (-4 * this.p5 * (rc(0.5 + d, b) - rc(0.5 - d, b))) / (2 * d);
    this.q = (TRACK * info.T * info.Rc) ** 2; // bit başı beklenen gecikme değişimi (çip²)
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
      const x0 = Math.max(0, (i0 - v) * TABLE);
      const k0 = Math.floor(x0);
      const fr = x0 - k0;
      let sr = 0;
      let si = 0;
      for (let t = 0, k = k0, i = i0; t < taps; t++, k += TABLE, i++) {
        const h = table[k] + fr * diff[k];
        sr += yr[i] * h;
        si += yi[i] * h;
      }
      zr[m] = sr;
      zi[m] = si;
    }
    const { code, N } = this.info;
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
    // faz dönmesi (bit başı)
    const vr = Vr[m];
    const vi = Vi[m];
    this.phase = Math.atan2(vi, vr);
    const w = S / (S * noise + (noise * noise) / 2);
    this.accR = (w * vr) / (R - 1);
    this.accI = (w * vi) / (R - 1);
    // Zaman ölçeklenmesi (saat farkı, hareket) taşıyıcı fazını ve çip zamanlamasını birlikte
    // kaydırır: gecikme bit başına δ artınca faz −2π·fc·δ döner. Hız, fazdan başlatılır;
    // güvenilirliği (faz kestiriminin varyansı) öncül belirsizlikle tartılır.
    const g = S / noise;
    const phaseVar = (2 / g + 1 / (g * g)) / (2 * (R - 1));
    const prior = ((TWO_PI * this.info.fc * MAX_RATE * this.info.T) / 2) ** 2;
    const rate = (-this.phase / (TWO_PI * this.info.fc)) * this.fs;
    this.rate = Math.max(-this.maxRate, Math.min(this.maxRate, (prior / (prior + phaseVar)) * rate));
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
        if (fingers.some((x) => Math.abs(x - l) < 2)) continue;
        best = l;
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
      const g = (2 * Math.sqrt(S)) / noise;
      llr += lnI0(g * Math.hypot(ar + pr[l], ai + pi[l])) - lnI0(g * Math.hypot(ar - pr[l], ai - pi[l]));
      const w = S / (S * noise + (noise * noise) / 2);
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
    this.phase = Math.atan2(this.accI, this.accR);
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
