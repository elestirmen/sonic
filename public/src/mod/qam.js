// OFDM-QAM — pilotlu, koherent OFDM (Mod 6), IEEE Std 802.11a-1999 (OFDM PHY) çizgisinde.
//
// Mod 3'ün (DQPSK-OFDM) koherent karşılığı: bilgi, taşıyıcının bir önceki kullanımına göre faz
// farkında değil, kendi genlik ve fazındadır (QPSK: 2, 16-QAM: 4 bit; 802.11a'nın Gray eşlemesi ve
// K_MOD ölçeği). Bunun bedeli kanal kestirimidir: hoparlörün, mikrofonun ve odanın her taşıyıcıdaki
// kazancı ve fazı G_k, paket başındaki bilinen eğitim sembollerinden ölçülür, sonra her sembolde
// pilotlarla ve kararlarla izlenir. Kazancı: farkta gürültü iki kez sayılmaz (DQPSK'ye göre ~2–3 dB),
// takımyıldız genliği de taşır. Bitler 802.11a'nın K = 7 (171/133) evrişimli koduyla korunur;
// alıcı her bit için max-log LLR üretir (Tosato ve Bisaglia 2002), çözme yumuşak kararlı Viterbi.
//
// Sembol: Tu = 1/spacing (10 ms, 100 Hz aralık) + CP (3,3 ms); alt taşıyıcılar f = k·spacing.
// Sıra: 2 tur eğitim · başlık (her profilde QPSK, en az 3 sembol) · veri. Her sembolde 4 pilot
// (802.11a: 52 taşıyıcıda 4; değerler 1, 1, 1, −1 × p_n, p_n 127 bitlik karıştırıcı dizisi).
//
// Alıcı modeli: Y_k(j) = G_k · X_k · e^{−j2π f_k τ(j)} + gürültü. Seste taşıyıcı osilatörü yoktur:
// saat farkı (±150 ppm), 44,1 ↔ 48 kHz dönüşümü ve cihaz hareketi yalnız zamanı kaydırır. 802.11a'nın
// ortak faz hatası (CPE) burada frekansla orantılı bir eğime dönüşür; tek bilinmeyen gecikme τ'dur.
//   · İki eğitim turu (802.11a'daki iki uzun eğitim sembolü T1, T2 gibi): ortalamaları G_k'yi,
//     farkları taşıyıcı başına gürültüyü, aralarındaki faz eğimi τ'nun değişim hızını verir
//     (802.11a'da ince frekans kayması kestirimi; burada zaman ölçeği kayması). G_k ayrıca komşu
//     taşıyıcılarla ortalanır (frekans ilintisi, van de Beek vd. 1995): iki ölçümün kestirim
//     gürültüsünün getirdiği kayıp ≈ 1,8 dB'den ≈ 0,7 dB'ye iner.
//   · Her veri sembolünde, öngörülen τ ile eşitlenmiş taşıyıcıların faz artıkları φ_k ≈ −2π f_k δ
//     sıfırdan geçen doğruya ağırlıklı en küçük karelerle uydurulur: önce yalnız pilotlarla, sonra
//     pilotlar + karar verilen veriyle. δ, iki durumlu (τ ve sembol başı değişimi) bir Kalman
//     süzgecine ölçüm olarak girer; FFT penceresi de τ ile kayar, CP içinde kalır.
//   · Karar yönlendirmeli izleme: her kararla G_k (LMS, μ = 0,1) ve taşıyıcı gürültüsü (üstel
//     ortalama) güncellenir; kanal paket boyunca yavaşça değişebilir, gürültü kestirimi netleşir.
//
// Oda yankısı CP'den çok uzundur; CP'yi aşan yankı gürültü gibi girişime dönüşür (hop 1'de
// SIR ≈ DRR). hop > 1 ise taşıyıcılar bitişik bloklara bölünür, her sembolde tek blok çalar
// (Mod 3'teki gibi; koherent OFDM'de bant atlamanın örneği MB-OFDM, Batra vd. 2004): bir taşıyıcı
// ancak hop sembol sonra yeniden kullanılır, eski yankısı sönmüş olur. Benzetimde (RT60 0,5 s,
// DRR 3 dB) alıcının ölçtüğü sinyal/girişim hop 1'de ~4, hop 2'de ~7, hop 3'te ~10 dB; hız hop'a bölünür.
//
// 802.11a'dan sapmalar (sese uyarlama):
//   1. Zaman ölçeği: 100 Hz aralık, 10 ms + 3,3 ms CP (802.11a: 312,5 kHz, 3,2 + 0,8 µs). Gerçel
//      geçiş bandı sinyali, taşıyıcılar fLow–fHigh arasında; DC boşluğu, I/Q yok.
//   2. Blok atlama (hop) ve blok başına 4 pilot. hop 1, 802.11a'nın düz yapısıdır.
//   3. Kısa eğitim dizisi yok (senkron paket başındaki chirp'le); uzun eğitim, CP'li iki tur,
//      değerleri 802.11a'nın L dizisi yerine düşük tepe/RMS'li Newman fazları.
//   4. Frekans kayması yok; ortak faz ve eğim tek bir τ ile Kalman süzgecinde izlenir, pencere kayar.
//      Kanalın frekansta yumuşatılması ve karar yönlendirmeli izlenmesi standartta yoktur (alıcıya
//      bırakılmıştır).
//   5. Serpiştirici: 802.11a'nın iki adımlı serpiştiricisi OFDM sembolü yerine bir "tur" (tüm bant,
//      hop sembol) üzerinde; N 16'nın katı değilse budanmış hâli. Önünde turlar arası zaman
//      serpiştirmesi var (DAB/DVB-T2 çizgisi): konuşma gibi hece ritminde gelen patlama gürültüsü
//      ardışık sembolleri siler; 802.11a yalnız sembol içinde serpiştirir. Benzetimde 0 dB konuşma
//      girişiminde (yankısız) hop 1 QPSK 10 denemede 4'ten 9'a çıktı, diğer koşullar değişmedi.
//   6. Karıştırıcı (x^7 + x^4 + 1) veri yerine serpiştirilmiş kodlu bitlere uygulanır: amaç aynı,
//      tekdüze veride (boş görsel alanı) tüm taşıyıcılar aynı noktaya düşüp tepe yapmasın.
//   7. SIGNAL alanı yerine Sonik başlığı (7 bayt, RS); en az 3 sembole döngüsel tekrarla yayılır.
//      Dolgu bitleri yerine son tur kodlu bitlerin tekrarıyla dolar (alıcı kopyaları toplar).
//   8. Yalnız oran 1/2 (802.11a'daki 2/3, 3/4 delme yok); dışta Sonik'in Reed-Solomon'u.
//   9. Tepe/RMS 2,3'te (Mod 3 gibi; 16-QAM Turbo'da 2,0) kırpılıp bant geçiren süzgeçten geçer.
//
// Denenip bırakılanlar (benzetimde ölçülebilir kazanç yok): alıcıda CP'ye taşan Nyquist penceresi
// (~0,2 dB), pencerenin CP içindeki konumu, anlık yerel gürültü kestirimi, ilk kararlarla kanalın
// ortalanması (μ = 1/n), 5–7 dokulu frekans yumuşatma, 64-QAM (hop 2'de bile yalnız "yan yana"
// çözüldü), 16-QAM + hop 2 (aynı hızdaki hop 1 QPSK gürültüde daha sağlam).

import { headerCodedBits } from '../codec/framing.js';
import { BandPass } from '../dsp/filters.js';

const TWO_PI = 2 * Math.PI;
const PILOTS = 4; // 802.11a: sembol başına 4 pilot
const PILOT_BASE = [1, 1, 1, -1]; // 802.11a pilot değerleri (−21, −7, 7, 21. taşıyıcılar)
const HEADER_BPSC = 2; // başlık her profilde QPSK (802.11a'da SIGNAL alanı en sağlam kiplemede)
const HEADER_MIN_SYMBOLS = 3; // başlık tek sembole sıkışmasın: patlama gürültüsüne karşı
const TIME_STEP = 5; // zaman serpiştirmesinde turdan tura kayma: ardışık bitler aynı taşıyıcıya düşmesin
const WINDOW_POS = 0.5; // alıcı penceresi CP'nin bu oranı kadar içeriden başlar
const MAX_RATE = 6e-4; // en büyük gecikme değişim hızı: 300 ppm saat farkı + ~10 cm/sn hareket
const DEFAULT_CREST = 2.3; // kırpma eşiği / RMS (Mod 3 ile aynı)
// Kalman süzgecinin sembol başı süreç gürültüsü: el titremesi ve sallamanın ivmesi (±3 cm, 0,7 Hz:
// gecikme ivmesi ≈ 1,7·10⁻³ s/s² → sembol başı hız değişimi ≈ 0,3 µs).
const TRACK_TAU_VAR = 0.3e-6 ** 2;
const TRACK_RATE_VAR = 0.2e-6 ** 2;
const NOISE_ALPHA = 0.15; // taşıyıcı gürültüsünün üstel ortalaması (kullanım başına)
const CHANNEL_MU = 0.1; // karar yönlendirmeli kanal izleme adımı (0,05–0,1 benzer; 0,3 bozar)

// ---------------------------------------------------------------- 802.11a yardımcıları

/**
 * 802.11a karıştırıcı dizisi (x^7 + x^4 + 1, başlangıç durumu 1111111): 127 bit.
 * Pilot kutupları (p_n: 0 → +1, 1 → −1) ve kodlu bitlerin beyazlatılması için.
 */
export const PN127 = (() => {
  const out = new Uint8Array(127);
  let s = 0x7f;
  for (let i = 0; i < 127; i++) {
    const b = ((s >> 6) ^ (s >> 3)) & 1;
    out[i] = b;
    s = ((s << 1) | b) & 0x7f;
  }
  return out;
})();

const permCache = new Map();

/**
 * 802.11a'nın iki adımlı serpiştiricisi, bir tur için: N kodlu bit, taşıyıcı başına m bit.
 * perm[k] = j: k. kodlu bit, turun j. konumuna gider (⌊j / m⌋. taşıyıcı).
 *   1. adım: i = (N/16)(k mod 16) + ⌊k/16⌋ — ardışık bitler birbirinden uzak taşıyıcılara;
 *   2. adım: j = s⌊i/s⌋ + (i + N − ⌊16i/N⌋) mod s, s = max(m/2, 1) — ardışık bitler takımyıldızın
 *            anlamlı ve az anlamlı bitleri arasında dönüşümlü.
 * N 16'nın katı değilse birinci adım 16 sütunlu satır-sütun serpiştirmenin budanmış hâlidir, ikinci
 * adımdaki sütun indisi (⌊16i/N⌋) grubun ilk konumunun sütunudur; 16 | N iken ikisi de standarttaki
 * formüle eşittir (bkz. test/qam.test.js).
 */
export function interleaverTable(N, m) {
  const key = `${N},${m}`;
  let perm = permCache.get(key);
  if (perm) return perm;
  const s = Math.max(m >> 1, 1);
  const full = Math.floor(N / 16);
  const rem = N % 16;
  const colStart = new Int32Array(17);
  for (let c = 0; c < 16; c++) colStart[c + 1] = colStart[c] + full + (c < rem ? 1 : 0);
  const colOf = new Int32Array(N);
  for (let c = 0; c < 16; c++) for (let i = colStart[c]; i < colStart[c + 1]; i++) colOf[i] = c;
  perm = new Int32Array(N);
  for (let k = 0; k < N; k++) {
    const i = colStart[k % 16] + Math.floor(k / 16);
    const g = Math.floor(i / s);
    perm[k] = g * s + ((((i % s) - colOf[g * s]) % s) + s) % s;
  }
  permCache.set(key, perm);
  return perm;
}

const axisCache = new Map();

/**
 * Kare QAM'in bir ekseni: Gray kodlu PAM (seviye m ↔ bitler m ^ (m >> 1), en anlamlı önce),
 * birim ortalama güç (802.11a K_MOD: QPSK 1/√2, 16-QAM 1/√10, 64-QAM 1/√42).
 */
function axis(bitsPerAxis) {
  let a = axisCache.get(bitsPerAxis);
  if (!a) {
    const Ma = 1 << bitsPerAxis;
    const scale = Math.sqrt(3 / (2 * (Ma * Ma - 1)));
    const levels = Float64Array.from({ length: Ma }, (_, m) => (2 * m - (Ma - 1)) * scale);
    const bits = Uint8Array.from({ length: Ma }, (_, m) => m ^ (m >> 1));
    const byValue = new Int32Array(Ma);
    for (let m = 0; m < Ma; m++) byValue[bits[m]] = m;
    a = { Ma, n: bitsPerAxis, scale, levels, bits, byValue };
    axisCache.set(bitsPerAxis, a);
  }
  return a;
}

// ---------------------------------------------------------------- düzen

/**
 * Blokların çalma sırası (profiles.js'teki Mod 3 kuralı): ardışık semboller mümkünse komşu
 * olmayan bloklara düşsün; 3 ve 4 blokta böyle döngüsel sıra yoktur.
 */
function blockOrder(L) {
  const order = [0];
  const used = new Set(order);
  const ok = (a, b) => Math.abs(a - b) > 1;
  const search = () => {
    if (order.length === L) return ok(order[L - 1], order[0]);
    for (let b = 1; b < L; b++) {
      if (used.has(b) || !ok(order[order.length - 1], b)) continue;
      order.push(b);
      used.add(b);
      if (search()) return true;
      order.pop();
      used.delete(b);
    }
    return false;
  };
  return L > 4 && search() ? order : Array.from({ length: L }, (_, i) => (L === 3 || L === 4 ? [0, 2, 1, 3][i] : i));
}

const infoCache = new WeakMap();

/**
 * Profil düzeni (profil başına bir kez). Taşıyıcılar f = k·spacing (fLow–fHigh), hop bitişik bloğa
 * bölünür; blokta 4 pilot (802.11a gibi eşit aralıklı), kalanı D veri taşıyıcısı. "Tur": hop ardışık
 * sembol, tüm bant bir kez (Nr = D·hop veri taşıyıcısı). T sembol süresi (s), lo–hi bant (Hz),
 * codedBitRate kodlu bit/sn (eğitim ve başlık hariç; pilot payı dahil).
 */
export function qamInfo(p) {
  let info = infoCache.get(p);
  if (!info) {
    const L = p.hop ?? 1;
    const k0 = Math.ceil(p.fLow / p.spacing - 1e-9);
    const k1 = Math.floor(p.fHigh / p.spacing + 1e-9);
    const Kb = Math.floor((k1 - k0 + 1) / L);
    const K = Kb * L;
    const pilotPos = Array.from({ length: PILOTS }, (_, j) => Math.floor((Kb * (2 * j + 1)) / (2 * PILOTS)));
    const isPilot = new Uint8Array(Kb);
    for (const i of pilotPos) isPilot[i] = 1;
    const dataPos = [];
    for (let i = 0; i < Kb; i++) if (!isPilot[i]) dataPos.push(i);
    const slot = new Int32Array(Kb).fill(-1);
    dataPos.forEach((i, d) => (slot[i] = d));
    const bpsc = Math.log2(p.qam);
    if (!Number.isInteger(bpsc) || bpsc % 2 || bpsc < 2) {
      throw new RangeError(`qam: desteklenmeyen takımyıldız ${p.qam}`);
    }
    const freqs = Float64Array.from({ length: K }, (_, i) => (k0 + i) * p.spacing);
    const Tu = 1 / p.spacing;
    const Ts = Tu + p.cpDur;
    info = {
      T: Ts,
      lo: freqs[0],
      hi: freqs[K - 1],
      codedBitRate: (dataPos.length * bpsc) / Ts,
      L,
      Kb,
      K,
      D: dataPos.length,
      Nr: dataPos.length * L,
      pilotPos,
      isPilot,
      dataPos,
      slot,
      freqs,
      bpsc,
      Tu,
      Ts,
      order: blockOrder(L),
    };
    infoCache.set(p, info);
  }
  return info;
}

/** Bir bölümün (başlık ya da veri) tur sayısı; başlık en az HEADER_MIN_SYMBOLS sembole yayılır. */
function partRounds(info, bits, m, header) {
  const r = Math.ceil(bits / (m * info.Nr));
  return header ? Math.max(r, Math.ceil(HEADER_MIN_SYMBOLS / info.L)) : r;
}

/** Eğitim + başlık + veri sembolleri. */
export function qamSymbolCount(p, headerBits, payloadBits) {
  const info = qamInfo(p);
  const header = partRounds(info, headerBits, HEADER_BPSC, true);
  return info.L * (2 + header + partRounds(info, payloadBits, info.bpsc, false));
}

/** Zaman serpiştirmesi: r. turun k. yerindeki (802.11a serpiştiricisinden önce) bit, bölümün q. biti. */
const sourceIndex = (k, r, N, rounds) => ((k - ((TIME_STEP * r) % N) + N) % N) * rounds + r;

/**
 * Bir bölümün kodlu bitleri → sembol başına veri taşıyıcılarının karmaşık değerleri.
 * Bitler döngüsel tekrarla R tura tamamlanır; q. bit r = q mod R. turun (⌊q/R⌋ + 5r) mod N. yerine
 * gider (ardışık kodlu bitler ardışık turlarda ve farklı taşıyıcılarda). Her tur 802.11a
 * serpiştiricisinden geçer, PN127 ile beyazlatılır; tur içinde taşıyıcılar frekans sırasındadır
 * (mantıksal taşıyıcı c = blok · D + yuva; her taşıyıcının ilk m/2 biti I, kalanı Q).
 */
function mapPart(bits, m, rounds, info) {
  const { L, D, Nr, order } = info;
  const N = m * Nr;
  const perm = interleaverTable(N, m);
  const ax = axis(m >> 1);
  const half = m >> 1;
  const out = [];
  const tmp = new Uint8Array(N);
  for (let r = 0; r < rounds; r++) {
    for (let k = 0; k < N; k++) tmp[perm[k]] = bits[sourceIndex(k, r, N, rounds) % bits.length];
    for (let j = 0; j < N; j++) tmp[j] ^= PN127[(r * N + j) % 127];
    for (let s = 0; s < L; s++) {
      const b = order[s];
      const re = new Float64Array(D);
      const im = new Float64Array(D);
      for (let d = 0; d < D; d++) {
        const o = (b * D + d) * m;
        let vi = 0;
        let vq = 0;
        for (let t = 0; t < half; t++) {
          vi = (vi << 1) | tmp[o + t];
          vq = (vq << 1) | tmp[o + half + t];
        }
        re[d] = ax.levels[ax.byValue[vi]];
        im[d] = ax.levels[ax.byValue[vq]];
      }
      out.push({ re, im });
    }
  }
  return out;
}

/** Eğitim sembolünün bloktaki i. taşıyıcısı: Newman fazları (birim genlik, tepe/RMS düşük). */
function trainingValue(i, Kb) {
  const a = (Math.PI * i * i) / Kb;
  return [Math.cos(a), Math.sin(a)];
}

/** n. veri sembolünün (başlık dahil) q. pilotu: 802.11a taban değeri × p_n kutbu. */
function pilotValue(q, n) {
  return PILOT_BASE[q] * (PN127[n % 127] ? -1 : 1);
}

/**
 * Sembolleri out'a ekler. start: ilk sembolün (CP dahil) başı, kesirli örnek no. Fazlar gerçek
 * zamana göre hesaplanır: her örnekleme hızında aynı sinyal. headerBits / payloadBits: evrişimli
 * kodlu (serpiştirilmemiş) bitler.
 */
export function renderQam(out, start, headerBits, payloadBits, p, fs, amplitude) {
  const info = qamInfo(p);
  const { L, Kb, freqs, order, dataPos, pilotPos, Ts } = info;
  const symbols = [
    ...mapPart(headerBits, HEADER_BPSC, partRounds(info, headerBits.length, HEADER_BPSC, true), info),
    ...mapPart(payloadBits, info.bpsc, partRounds(info, payloadBits.length, info.bpsc, false), info),
  ];
  const nSym = 2 * L + symbols.length;
  const S = Ts * fs;
  const C = p.cpDur * fs;
  const R = p.rollDur * fs;
  const first = Math.ceil(start - R / 2);
  const seg = new Float64Array(Math.floor(start + nSym * S + R / 2) - first + 1);
  const xr = new Float64Array(Kb);
  const xi = new Float64Array(Kb);

  for (let n = 0; n < nSym; n++) {
    const lo = order[n % L] * Kb;
    if (n < 2 * L) {
      for (let i = 0; i < Kb; i++) [xr[i], xi[i]] = trainingValue(i, Kb);
    } else {
      const sym = symbols[n - 2 * L];
      for (let d = 0; d < dataPos.length; d++) {
        xr[dataPos[d]] = sym.re[d];
        xi[dataPos[d]] = sym.im[d];
      }
      for (let q = 0; q < PILOTS; q++) {
        xr[pilotPos[q]] = pilotValue(q, n - 2 * L);
        xi[pilotPos[q]] = 0;
      }
    }
    // Sembol, iki yanda R/2 taşan yükseltilmiş kosinüs kenarlarla çizilir (Mod 3 gibi); komşuyla
    // örtüşme yalnız CP'nin başına düşer, alıcı penceresi oraya uzanmaz.
    const u = start + n * S;
    const ref = u + C; // faz başvurusu: yararlı bölümün başı
    const i0 = Math.ceil(u - R / 2);
    const i1 = Math.floor(u + S + R / 2);
    for (let i = 0; i < Kb; i++) {
      const w = (TWO_PI * freqs[lo + i]) / fs;
      const ph = w * (i0 - ref);
      let cr = Math.cos(ph);
      let ci = Math.sin(ph);
      const dr = Math.cos(w);
      const di = Math.sin(w);
      const ar = xr[i];
      const ai = xi[i];
      for (let t = i0, o = i0 - first; t <= i1; t++, o++) {
        const x = t - (u - R / 2);
        const y = u + S + R / 2 - t;
        const edge = Math.min(x, y);
        const env = edge < R ? 0.5 - 0.5 * Math.cos((Math.PI * edge) / R) : 1;
        seg[o] += env * (ar * cr - ai * ci); // Re{X · e^{jω(t − ref)}}
        const tt = cr * dr - ci * di;
        ci = cr * di + ci * dr;
        cr = tt;
      }
    }
  }

  // Tepe/RMS sınırı: kırp, bant dışına taşan kırpma gürültüsünü süz, tepeyi genliğe ölçekle.
  let energy = 0;
  for (let i = 0; i < seg.length; i++) energy += seg[i] * seg[i];
  const clip = (p.crest ?? DEFAULT_CREST) * Math.sqrt(energy / seg.length);
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

// ---------------------------------------------------------------- alıcı

const EMPTY = {};

function wrap(a) {
  return a - TWO_PI * Math.round(a / TWO_PI);
}

/** En yakın PAM seviyesi (sert karar). */
function decide(y, ax) {
  const { Ma, scale, levels } = ax;
  const m = Math.round((y / scale + (Ma - 1)) / 2);
  return levels[m < 0 ? 0 : m >= Ma ? Ma - 1 : m];
}

/** Bir eksenin bitleri için max-log LLR (log P(0)/P(1)): (min₁ |y − a|² − min₀ |y − a|²) / σ². */
function axisLlr(y, ax, nz, soft, o, min0, min1) {
  const { Ma, n, levels, bits } = ax;
  min0.fill(Infinity);
  min1.fill(Infinity);
  for (let m = 0; m < Ma; m++) {
    const e = (y - levels[m]) ** 2;
    const v = bits[m];
    for (let t = 0; t < n; t++) {
      if ((v >> (n - 1 - t)) & 1) {
        if (e < min1[t]) min1[t] = e;
      } else if (e < min0[t]) min0[t] = e;
    }
  }
  for (let t = 0; t < n; t++) soft[o + t] = (min1[t] - min0[t]) / nz;
}

/**
 * Tek paketin alıcısı. read(j): eğitim sembollerinde {} (son eğitimde kanal kestirimi), başlık ve
 * veri sembollerinde { soft, margin, snr }. Durum semboller arasında taşınır (τ, G_k, gürültü).
 */
export class QamDemod {
  constructor(p, fs, start) {
    const info = qamInfo(p);
    this.p = p;
    this.fs = fs;
    this.info = info;
    this.start = start;
    this.N = Math.round(info.Tu * fs);
    this.S = info.Ts * fs;
    this.offset = WINDOW_POS * p.cpDur * fs;
    this.H = info.L * partRounds(info, headerCodedBits(p), HEADER_BPSC, true);
    this.bitsPerSymbol = info.bpsc * info.D;
    const K = info.K;
    this.w = new Float64Array(K);
    this.cw = new Float64Array(K);
    this.sw = new Float64Array(K);
    this.coef = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      const w = (TWO_PI * info.freqs[k]) / fs;
      this.w[k] = w;
      this.cw[k] = Math.cos(w);
      this.sw[k] = Math.sin(w);
      this.coef[k] = 2 * Math.cos(w);
    }
    this.buf = new Float32Array(this.N);
    this.yr = new Float64Array(K); // son ölçülen blok
    this.yi = new Float64Array(K);
    this.t1r = new Float64Array(K); // birinci eğitim turu
    this.t1i = new Float64Array(K);
    this.t2r = new Float64Array(K); // ikinci eğitim turu
    this.t2i = new Float64Array(K);
    this.gr = new Float64Array(K); // kanal G_k
    this.gi = new Float64Array(K);
    this.noise = new Float64Array(K); // taşıyıcı başına gürültü + girişim gücü (Y cinsinden)
    this.noiseFloor = 0;
    this.pilot = new Float64Array(info.Kb);
    this.zr = new Float64Array(info.Kb);
    this.zi = new Float64Array(info.Kb);
    this.min0 = new Float64Array(info.bpsc >> 1);
    this.min1 = new Float64Array(info.bpsc >> 1);
    // τ izleyici (Kalman): durum gecikme τ (s) ve sembol başına değişimi v (s); at: durumun sembolü
    this.tau = 0;
    this.v = 0;
    this.P = [0, 0, 0, 0]; // [Pττ, Pτv, Pvτ, Pvv]
    this.at = 0;
  }

  windowStart(j) {
    return this.start + j * this.S + this.offset;
  }

  /** j. sembol için öngörülen gecikme (s); pencere buna göre kayar. */
  predict(j) {
    return this.tau + this.v * (j - this.at);
  }

  windowEnd(j) {
    return Math.round(this.windowStart(j) + this.predict(j) * this.fs) + this.N;
  }

  /** Goertzel ile bloktaki her taşıyıcının karmaşık genliği; faz, pencerenin nominal başına göre. */
  measure(store, j, lo, hi) {
    const w0 = this.windowStart(j);
    const s = Math.round(w0 + this.predict(j) * this.fs);
    if (!store.read(s, this.buf)) return false;
    const { N, buf, yr, yi } = this;
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
    const { L, Kb, order } = this.info;
    const lo = order[j % L] * Kb;
    if (!this.measure(store, j, lo, lo + Kb)) return null;
    if (j < 2 * L) {
      const [dr, di] = j < L ? [this.t1r, this.t1i] : [this.t2r, this.t2i];
      dr.set(this.yr.subarray(lo, lo + Kb), lo);
      di.set(this.yi.subarray(lo, lo + Kb), lo);
      if (j === 2 * L - 1) this.acquire();
      return EMPTY;
    }
    return this.data(j, lo, j < 2 * L + this.H ? HEADER_BPSC : this.info.bpsc);
  }

  /**
   * İki eğitim turundan: aralarındaki gecikme artışı Δ (L sembol) → v; kanal G_k (τ(j) = v·j ile
   * geri döndürülmüş iki ölçümün ortalaması); gürültü (farkları, komşu taşıyıcılar ve bant
   * ortalamasıyla yumuşatılmış). Δ, d_k = T2 · conj(T1) fazlarının sıfırdan geçen doğrusundan:
   * önce fiziksel aralıkta ızgara, sonra en küçük kareler (100 Hz ızgarada belirsizlik ±5 ms'dedir).
   */
  acquire() {
    const { K, L, Kb, Ts, freqs, order } = this.info;
    const dr = new Float64Array(K);
    const di = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      dr[k] = this.t2r[k] * this.t1r[k] + this.t2i[k] * this.t1i[k];
      di[k] = this.t2i[k] * this.t1r[k] - this.t2r[k] * this.t1i[k];
    }
    const range = MAX_RATE * L * Ts;
    const step = 1 / (16 * freqs[K - 1]);
    let delta = 0;
    let bestScore = -Infinity;
    for (let t = -range; t <= range + 1e-12; t += step) {
      let s = 0;
      for (let k = 0; k < K; k++) {
        const a = TWO_PI * freqs[k] * t;
        s += dr[k] * Math.cos(a) - di[k] * Math.sin(a);
      }
      if (s > bestScore) {
        bestScore = s;
        delta = t;
      }
    }
    for (let iter = 0; iter < 3; iter++) {
      let num = 0;
      let den = 0;
      for (let k = 0; k < K; k++) {
        const amp = Math.hypot(dr[k], di[k]);
        const r = wrap(Math.atan2(di[k], dr[k]) + TWO_PI * freqs[k] * delta);
        num += amp * freqs[k] * r;
        den += amp * freqs[k] * freqs[k];
      }
      if (den === 0) break;
      delta -= num / (TWO_PI * den);
    }
    delta = Math.max(-range, Math.min(range, delta));
    this.v = delta / L;

    const raw = new Float64Array(K);
    let mean = 0;
    let gain = 0;
    for (let b = 0; b < L; b++) {
      const j1 = order.indexOf(b);
      for (let i = 0; i < Kb; i++) {
        const k = b * Kb + i;
        const a1 = TWO_PI * freqs[k] * this.v * j1;
        const a2 = TWO_PI * freqs[k] * this.v * (j1 + L);
        const ar = this.t1r[k] * Math.cos(a1) - this.t1i[k] * Math.sin(a1);
        const ai = this.t1r[k] * Math.sin(a1) + this.t1i[k] * Math.cos(a1);
        const br = this.t2r[k] * Math.cos(a2) - this.t2i[k] * Math.sin(a2);
        const bi = this.t2r[k] * Math.sin(a2) + this.t2i[k] * Math.cos(a2);
        const [xr, xi] = trainingValue(i, Kb);
        const sr = 0.5 * (ar + br);
        const si = 0.5 * (ai + bi);
        this.gr[k] = sr * xr + si * xi; // · conj(X), |X| = 1
        this.gi[k] = si * xr - sr * xi;
        raw[k] = ((br - ar) ** 2 + (bi - ai) ** 2) / 2; // fark, tek ölçümün gürültüsünün iki katı
        mean += raw[k];
        gain += this.gr[k] ** 2 + this.gi[k] ** 2;
      }
    }
    mean /= K;
    gain /= K;
    this.smoothChannel();
    this.noiseFloor = 1e-6 * gain + 1e-24; // en çok ~60 dB SNR: LLR'ler taşmasın; sessizlikte de > 0
    let prec = 0; // Δ'nın duyarlığı: d_k fazının varyansı ≈ 2·N_k / |G_k|²
    for (let b = 0; b < L; b++) {
      for (let i = 0; i < Kb; i++) {
        let s = 0;
        let n = 0;
        for (let d = Math.max(0, i - 2); d <= Math.min(Kb - 1, i + 2); d++) {
          s += raw[b * Kb + d];
          n++;
        }
        const k = b * Kb + i;
        this.noise[k] = 0.5 * (s / n) + 0.5 * mean + this.noiseFloor;
        prec += ((this.gr[k] ** 2 + this.gi[k] ** 2) / (2 * this.noise[k])) * freqs[k] * freqs[k];
      }
    }
    const vMax = (MAX_RATE * Ts) ** 2; // öncül: sembol başı değişim en çok MAX_RATE · Ts
    const vv = prec > 0 ? Math.min(vMax, 1 / (4 * Math.PI * Math.PI * prec * L * L)) + 1e-18 : vMax;
    this.at = 2 * L - 1;
    this.tau = this.v * this.at;
    this.P = [vv * this.at * this.at + 1e-14, vv * this.at, vv * this.at, vv];
  }

  /**
   * Eğitimden gelen G_k'yi blok içinde komşu taşıyıcılarla ortalar (3 dokulu, eşit ağırlık; kenarda
   * 2): iki ölçümün kestirim gürültüsü üçte birine iner (kayıp ≈ 1,8 → 0,7 dB). Önce bloğun ortalama
   * faz eğimi (pencerenin CP içindeki yeri ve senkron gecikmesi, taşıyıcı başına ~1 rad)
   * θ = arg Σ G_{k+1} conj(G_k) çıkarılır. Oda yankısının pencereye düşen kısmı G'yi taşıyıcıdan
   * taşıyıcıya değiştirdiği hâlde benzetimde kazanç baskın çıktı (DRR 3 dB'de hop 1 QPSK 0 → 6/10).
   * Frekans ilintisinden yararlanan kestirimin basit bir örneği (bkz. van de Beek vd. 1995).
   */
  smoothChannel() {
    const { L, Kb } = this.info;
    const r = new Float64Array(Kb);
    const q = new Float64Array(Kb);
    for (let b = 0; b < L; b++) {
      const o = b * Kb;
      let sr = 0;
      let si = 0;
      for (let i = o; i + 1 < o + Kb; i++) {
        sr += this.gr[i + 1] * this.gr[i] + this.gi[i + 1] * this.gi[i];
        si += this.gi[i + 1] * this.gr[i] - this.gr[i + 1] * this.gi[i];
      }
      const th = Math.atan2(si, sr);
      const c = Math.cos(th);
      const sn = Math.sin(th);
      for (let i = 0; i < Kb; i++) {
        const k = o + i;
        let accR = this.gr[k];
        let accI = this.gi[k];
        let n = 1;
        if (i > 0) {
          // G_{k−1} · e^{jθ}
          accR += this.gr[k - 1] * c - this.gi[k - 1] * sn;
          accI += this.gr[k - 1] * sn + this.gi[k - 1] * c;
          n++;
        }
        if (i + 1 < Kb) {
          // G_{k+1} · e^{−jθ}
          accR += this.gr[k + 1] * c + this.gi[k + 1] * sn;
          accI += this.gi[k + 1] * c - this.gr[k + 1] * sn;
          n++;
        }
        r[i] = accR / n;
        q[i] = accI / n;
      }
      this.gr.set(r, o);
      this.gi.set(q, o);
    }
  }

  /** z = Y / (G · e^{−j2πfτ}); sonuç this.zr/zi[i]. */
  equalize(i, k, tau) {
    const a = TWO_PI * this.info.freqs[k] * tau;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const yr = this.yr[k] * ca - this.yi[k] * sa;
    const yi = this.yr[k] * sa + this.yi[k] * ca;
    const g2 = this.gr[k] ** 2 + this.gi[k] ** 2 || 1e-30;
    this.zr[i] = (yr * this.gr[k] + yi * this.gi[k]) / g2;
    this.zi[i] = (yi * this.gr[k] - yr * this.gi[k]) / g2;
  }

  /**
   * tauRef'e göre kalan gecikme: pilotların (useData ise karar verilen veri taşıyıcılarının da)
   * faz artıkları φ_k ≈ −2π f_k δ, duyarlıkla (2|G|²|s|²/N) ağırlıklı, sıfırdan geçen doğruya.
   */
  fit(lo, tauRef, ax, useData) {
    const { Kb, isPilot, freqs } = this.info;
    let num = 0;
    let den = 0;
    for (let i = 0; i < Kb; i++) {
      if (!isPilot[i] && !useData) continue;
      const k = lo + i;
      this.equalize(i, k, tauRef);
      const zr = this.zr[i];
      const zi = this.zi[i];
      const sr = isPilot[i] ? this.pilot[i] : decide(zr, ax);
      const si = isPilot[i] ? 0 : decide(zi, ax);
      const phi = Math.atan2(zi * sr - zr * si, zr * sr + zi * si);
      const prec = (2 * (this.gr[k] ** 2 + this.gi[k] ** 2) * (sr * sr + si * si)) / this.noise[k];
      num += prec * freqs[k] * phi;
      den += prec * freqs[k] * freqs[k];
    }
    if (den === 0) return { delta: 0, R: Infinity };
    return { delta: -num / (TWO_PI * den), R: 1 / (4 * Math.PI * Math.PI * den) };
  }

  /** Kalman güncellemesi: öngörü (tauP, Pp), ölçüm meas (varyans R). */
  static update(tauP, Pp, meas, R) {
    const [a, b, c, d] = Pp;
    const k1 = a / (a + R);
    const k2 = c / (a + R);
    const nu = meas - tauP;
    return { tau: tauP + k1 * nu, dv: k2 * nu, P: [(1 - k1) * a, (1 - k1) * b, c - k2 * a, d - k2 * b] };
  }

  data(j, lo, m) {
    const { Kb, isPilot, pilotPos, slot, D } = this.info;
    const n = j - 2 * this.info.L; // veri sembolü sırası (pilot kutbu)
    for (let q = 0; q < PILOTS; q++) this.pilot[pilotPos[q]] = pilotValue(q, n);
    const ax = axis(m >> 1);

    // Öngörü, sonra iki ölçüm: yalnız pilotlar; pilotlar + kararlar (ilkinin sonucuyla eşitlenmiş).
    const steps = j - this.at;
    const tauP = this.tau + this.v * steps;
    const [a, b, c, d] = this.P;
    const Pp = [
      a + steps * (b + c) + steps * steps * d + TRACK_TAU_VAR * steps,
      b + steps * d,
      c + steps * d,
      d + TRACK_RATE_VAR * steps,
    ];
    const m0 = this.fit(lo, tauP, ax, false);
    const u0 = QamDemod.update(tauP, Pp, tauP + m0.delta, m0.R);
    const m1 = this.fit(lo, u0.tau, ax, true);
    const u1 = QamDemod.update(tauP, Pp, u0.tau + m1.delta, m1.R);
    this.tau = u1.tau;
    this.v += u1.dv;
    this.P = u1.P;
    this.at = j;

    // LLR'ler, sonra karar yönlendirmeli gürültü ve kanal güncellemesi.
    const half = m >> 1;
    const soft = new Float32Array(D * m);
    let snrSum = 0;
    let marginSum = 0;
    for (let i = 0; i < Kb; i++) {
      const k = lo + i;
      this.equalize(i, k, this.tau);
      const zr = this.zr[i];
      const zi = this.zi[i];
      const g2 = this.gr[k] ** 2 + this.gi[k] ** 2;
      let sr;
      let si;
      if (isPilot[i]) {
        sr = this.pilot[i];
        si = 0;
      } else {
        const nz = this.noise[k] / (g2 || 1e-30); // z cinsinden gürültü
        axisLlr(zr, ax, nz, soft, slot[i] * m, this.min0, this.min1);
        axisLlr(zi, ax, nz, soft, slot[i] * m + half, this.min0, this.min1);
        sr = decide(zr, ax);
        si = decide(zi, ax);
        snrSum += g2 / this.noise[k];
        marginSum += (ax.scale * ax.scale) / nz; // (yarım karar aralığı)² / σ²
      }
      const er = zr - sr;
      const ei = zi - si;
      this.noise[k] = (1 - NOISE_ALPHA) * this.noise[k] + NOISE_ALPHA * (er * er + ei * ei) * g2 + this.noiseFloor;
      // G ← G · (1 + μ · conj(s)(z − s)) = G + μ|s|²(Y'/s − G): iç noktalar az ağırlık alır.
      // Sabit adım: ilk kararlara ortalama gibi büyük ağırlık vermek (μ = 1/n) düşük SNR'de
      // yanlış kararları kanala işledi, kısa pakette de kazanç ölçülemedi.
      const mu = CHANNEL_MU;
      const ur = sr * er + si * ei;
      const ui = sr * ei - si * er;
      const gr = this.gr[k];
      const gi = this.gi[k];
      this.gr[k] += mu * (gr * ur - gi * ui);
      this.gi[k] += mu * (gr * ui + gi * ur);
    }
    const db = (x) => 10 * Math.log10(Math.max(x / D, 1e-10));
    return { soft, margin: db(marginSum), snr: db(snrSum) };
  }

  symbolsFor(bits, part) {
    const header = part === 'header';
    return this.info.L * partRounds(this.info, bits, header ? HEADER_BPSC : this.info.bpsc, header);
  }

  /**
   * mapPart'ın tersi: sembol sırası → mantıksal taşıyıcı sırası, beyazlatmayı geri al (işaret),
   * 802.11a serpiştiricisini ve zaman serpiştirmesini çöz, tekrarlanan bitlerin LLR'lerini topla.
   */
  deinterleave(flat, n, part) {
    const m = part === 'header' ? HEADER_BPSC : this.info.bpsc;
    const { L, D, Nr, order } = this.info;
    const N = m * Nr;
    const rounds = Math.floor(flat.length / N);
    const perm = interleaverTable(N, m);
    const out = new Float32Array(n);
    const tmp = new Float64Array(N);
    for (let r = 0; r < rounds; r++) {
      for (let s = 0; s < L; s++) {
        const base = order[s] * D * m;
        for (let q = 0; q < D * m; q++) {
          const v = flat[r * N + s * D * m + q];
          tmp[base + q] = PN127[(r * N + base + q) % 127] ? -v : v;
        }
      }
      for (let k = 0; k < N; k++) out[sourceIndex(k, r, N, rounds) % n] += tmp[perm[k]];
    }
    return out;
  }
}
