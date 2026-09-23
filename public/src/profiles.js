// Modem profilleri. Zamanlar saniye, frekanslar Hz; örnek sayıları her
// cihazın kendi örnekleme hızına göre hesaplanır, bu yüzden 44.1 kHz'lik
// bir verici ile 48 kHz'lik bir alıcı sorunsuz konuşur.
//
// Ton ızgarası — kanal c, küme s, değer v (0–15):
//   f = fStart + toneSpacing · (c · sets · 16 + v · sets + s)
// Ardışık semboller farklı kümeden ton kullanır (s = sembol no mod sets);
// böylece bir önceki sembolün oda yankısı, çözülen kümeye düşmez. Aynı küme
// ancak (sets − 1) · symbolDur + skipDur sonra yeniden duyulur; yankılı odada
// belirleyici olan bu "yankı yaşı"dır (simülasyonda ~190 ms, RT60 1 s'lik
// salonda bile yetti; ~60 ms'de uzak mesafede paketlerin çoğu kayboluyordu).
//
// Pencere (windowDur) Hann ile çarpılır; toneSpacing ≥ 2 / windowDur olduğu
// sürece komşu tonlar pencerenin sıfırlarına denk gelir ve birbirine sızmaz.

export const PRE_SILENCE = 0.15; // bazı hoparlör yükselteçleri ilk anları yutar
export const POST_SILENCE = 0.1;
export const VALUES_PER_TONE = 16;

export const PROFILES = [
  {
    id: 0,
    key: 'normal',
    name: 'Normal',
    summary: '1–3 m; yankılı odada da güvenilir',
    fStart: 2000,
    toneSpacing: 40,
    channels: 2,
    sets: 4,
    symbolDur: 0.06,
    skipDur: 0.009,
    windowDur: 0.05,
    rampDur: 0.005,
    chirp: { from: 1850, to: 7300, dur: 0.15 },
    gapDur: 0.05,
    fecRatio: 0.3,
    fecMin: 8,
  },
  {
    id: 1,
    key: 'saglam',
    name: 'Sağlam',
    summary: 'uzak mesafe, gürültülü ve çok yankılı ortam; yavaş',
    fStart: 1600,
    toneSpacing: 40,
    channels: 1,
    sets: 3,
    symbolDur: 0.1,
    skipDur: 0.02,
    windowDur: 0.075,
    rampDur: 0.008,
    chirp: { from: 3650, to: 1450, dur: 0.2 }, // aşağı süpürme: diğer profillerden ayırt edilir
    gapDur: 0.06,
    fecRatio: 0.5,
    fecMin: 10,
  },
  {
    id: 2,
    key: 'hizli',
    name: 'Hızlı',
    summary: 'yakın mesafe (≤ 1 m); Normal’in iki katı hız',
    fStart: 1500,
    toneSpacing: 40,
    channels: 4,
    sets: 3,
    symbolDur: 0.058,
    skipDur: 0.007,
    windowDur: 0.05,
    rampDur: 0.004,
    chirp: { from: 1400, to: 9400, dur: 0.1 },
    gapDur: 0.04,
    fecRatio: 0.25,
    fecMin: 8,
  },
  {
    id: 3,
    key: 'ultrasonik',
    name: 'Ultrasonik',
    summary: 'neredeyse duyulmaz; cihaz desteği değişir',
    fStart: 17500,
    toneSpacing: 45,
    channels: 1,
    sets: 3,
    symbolDur: 0.057,
    skipDur: 0.011,
    windowDur: 0.045,
    rampDur: 0.01,
    chirp: { from: 17300, to: 19800, dur: 0.15 },
    gapDur: 0.05,
    fecRatio: 0.3,
    fecMin: 8,
  },
];

export const PROFILE_BY_KEY = Object.fromEntries(PROFILES.map((p) => [p.key, p]));

export function getProfile(key) {
  const p = PROFILE_BY_KEY[key];
  if (!p) throw new Error(`bilinmeyen profil: ${key}`);
  return p;
}

export function toneFrequency(p, channel, set, value) {
  return p.fStart + p.toneSpacing * (channel * p.sets * VALUES_PER_TONE + value * p.sets + set);
}

/** Profilin kapladığı frekans aralığı (spektrogram işaretleri ve süzgeçler için). */
export function profileBand(p) {
  const top = toneFrequency(p, p.channels - 1, p.sets - 1, VALUES_PER_TONE - 1);
  return {
    lo: Math.min(p.fStart, p.chirp.from, p.chirp.to),
    hi: Math.max(top, p.chirp.from, p.chirp.to),
  };
}

/** Örnekleme hızı bu profilin en yüksek frekansını taşıyabiliyor mu (Nyquist payıyla)? */
export function supportsProfile(profile, fs) {
  return profileBand(profile).hi < 0.48 * fs;
}

/** Ham bit hızı (bayt/sn), hata düzeltme payı hariç. */
export function rawByteRate(p) {
  return (p.channels * 4) / 8 / p.symbolDur;
}
