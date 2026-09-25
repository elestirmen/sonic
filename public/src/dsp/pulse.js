// Tek taşıyıcılı yöntemlerin (DSSS, SC-DFE) ortak darbesi: kök yükseltilmiş kosinüs (RRC).
// Verici darbeyi tablodan ara değerleyerek çizer; alıcı aynı darbeyi uyumlu süzgeç olarak
// kullanır (RRC * RRC = yükseltilmiş kosinüs: örnekleme anlarında ISI yok).

export const TX_TAPS = 5; // verici darbesinin yarı uzunluğu (sembol ya da çip)
export const TX_TABLE = 256; // verici darbe tablosunun sembol başına çözünürlüğü
export const RX_TAPS = 3; // alıcı uyumlu süzgecinin yarı uzunluğu: ISI −46 dB, uyumsuzluk kaybı 0,002 dB
export const RX_TABLE = 64; // alıcı çekirdek tablosunun örnek başına çözünürlüğü
const TAPER = 1; // darbe uçlarındaki kosinüs geçişi (sembol)

/** Kök yükseltilmiş kosinüs darbesi (t sembol cinsinden, birim enerji). */
export function rrc(t, b) {
  const pi = Math.PI;
  if (Math.abs(t) < 1e-9) return 1 - b + (4 * b) / pi;
  if (Math.abs(Math.abs(t) - 1 / (4 * b)) < 1e-9) {
    const x = pi / (4 * b);
    return (b / Math.SQRT2) * ((1 + 2 / pi) * Math.sin(x) + (1 - 2 / pi) * Math.cos(x));
  }
  const num = Math.sin(pi * t * (1 - b)) + 4 * b * t * Math.cos(pi * t * (1 + b));
  return num / (pi * t * (1 - (4 * b * t) ** 2));
}

/** Kesilmiş RRC: uçları TAPER sembol boyunca kosinüsle sıfıra iner. */
export function pulse(t, b, taps) {
  const a = Math.abs(t);
  if (a >= taps) return 0;
  const w = a <= taps - TAPER ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (a - taps + TAPER)) / TAPER);
  return rrc(t, b) * w;
}

/** Yükseltilmiş kosinüs (RRC * RRC): alıcı çıkışındaki darbe. */
export function rc(t, b) {
  const s = Math.abs(t) < 1e-9 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
  const d = 1 - (2 * b * t) ** 2;
  return Math.abs(d) < 1e-9 ? (Math.PI / 4) * s : (s * Math.cos(Math.PI * b * t)) / d;
}

const txTables = new Map();

/** Verici darbesi, t = i / TX_TABLE − TX_TAPS sembolde; ara değerleme için bir fazla. */
export function txTable(beta) {
  let t = txTables.get(beta);
  if (!t) {
    const n = 2 * TX_TAPS * TX_TABLE + 2;
    t = new Float64Array(n);
    for (let i = 0; i < n; i++) t[i] = pulse(i / TX_TABLE - TX_TAPS, beta, TX_TAPS);
    txTables.set(beta, t);
  }
  return t;
}

const rxKernels = new Map();

/** Alıcı uyumlu süzgeci (RRC), örnek cinsinden tablo; komşu farkları ara değerleme için. spc: sembol başına örnek. */
export function rxKernel(spc, beta) {
  const key = `${spc.toFixed(6)}:${beta}`;
  let k = rxKernels.get(key);
  if (!k) {
    const half = Math.ceil(RX_TAPS * spc);
    const n = (2 * half + 3) * RX_TABLE;
    const table = new Float64Array(n);
    const diff = new Float64Array(n);
    for (let i = 0; i < n; i++) table[i] = pulse((i / RX_TABLE - half) / spc, beta, RX_TAPS) / spc;
    for (let i = 0; i + 1 < n; i++) diff[i] = table[i + 1] - table[i];
    k = { half, taps: 2 * half + 1, table, diff };
    rxKernels.set(key, k);
  }
  return k;
}
