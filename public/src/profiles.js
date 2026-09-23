// Modem profilleri. Zamanlar saniye, frekanslar Hz; örnek sayıları her
// cihazın kendi örnekleme hızına göre hesaplanır, bu yüzden 44.1 kHz'lik
// bir verici ile 48 kHz'lik bir alıcı sorunsuz konuşur.
//
// Yedi yöntem (mod) var; her biri literatürde yerleşik bir kipleme. İlk üçü:
//
// MFSK (mod: 'mfsk') — ton ızgarası, kanal c, küme s, değer v (0–15):
//   f = fStart + toneSpacing · (c · sets · 16 + v · sets + s)
// Ardışık semboller farklı kümeden ton kullanır (s = sembol no mod sets);
// böylece bir önceki sembolün oda yankısı, çözülen kümeye düşmez. Aynı küme
// ancak (sets − 1) · symbolDur + skipDur sonra yeniden duyulur; yankılı odada
// belirleyici olan bu "yankı yaşı"dır (simülasyonda ~190 ms, RT60 1 s'lik
// salonda bile yetti; ~60 ms'de uzak mesafede paketlerin çoğu kayboluyordu).
// Pencere (windowDur) Hann ile çarpılır; toneSpacing ≥ 2 / windowDur olduğu
// sürece komşu tonlar pencerenin sıfırlarına denk gelir ve birbirine sızmaz.
//
// OFDM (mod: 'ofdm', bkz. mod/ofdm.js) — fLow–fHigh arasında spacing aralıklı
// alt taşıyıcılar, her biri diferansiyel PSK ile psk = 4 → 2 bit, 2 → 1 bit.
// Sembol = cpDur koruma + 1/spacing. Bant verimi MFSK'nin onlarca katı, ama oda
// yankısı koruma aralığını aşınca sembolleri karıştırır: yalnız yakın mesafe.
//
// CSS (mod: 'css', bkz. mod/css.js) — LoRa tipi chirp yayılı spektrum: fLow–fHigh
// bandında 2^sf kaymalı chirp'ler, her sembol sf bit. Bitler K = 7 evrişimli kodla
// (code: 'conv') korunur; alıcı yumuşak kararlı Viterbi kullanır.
//
// Mod 4–7 (DSSS, JANUS, OFDM-QAM, FT8; bkz. mod/*.js) de iç kodludur (code: 'conv',
// 'conv9' ya da 'ldpc'). Kendi zaman, bant ve hız bilgilerini <mod>Info(p) ile verirler.
// Senkron chirp'lerini paylaşırlar: düşük SNR'ye yönelik olanlar (DSSS, JANUS, FT8)
// bantlarındaki CSS chirp'ini, OFDM-QAM ise OFDM chirp'ini kullanır. Böylece dinlerken
// işlemci yükü artmaz ve karşılaştırmada her yöntem aynı senkronla başlar.
//
// Varsayılan yöntem MFSK'dir. Diğerleri deneyseldir (experimental): arayüz onları ancak
// kullanıcı açınca sunar; canlı dinleme de onları ancak o zaman dener (telefonda işlemci
// payı). Dosyadan çözme ve simülasyon her zaman tüm yöntemleri dener.

import { HEADER_NIBBLES, innerCode } from './codec/framing.js';
import { cssInfo } from './mod/css.js';
import { dsssInfo } from './mod/dsss.js';
import { janusInfo } from './mod/janus.js';
import { qamInfo } from './mod/qam.js';
import { ft8Info } from './mod/ft8.js';

export const PRE_SILENCE = 0.15; // bazı hoparlör yükselteçleri ilk anları yutar
export const POST_SILENCE = 0.1;
export const VALUES_PER_TONE = 16;

export const BANDS = [
  { key: 'std', name: 'Standart', hint: 'en geniş cihaz desteği' },
  { key: 'high', name: 'Yüksek', hint: 'daha az duyulur; konuşma ve müzikten az etkilenir' },
  { key: 'ultra', name: 'Ultrasonik', hint: 'neredeyse duyulmaz; hoparlör/mikrofon desteği değişir' },
];

export const MODES = [
  {
    key: 'mfsk',
    num: 1,
    name: 'MFSK',
    title: 'frekans atlamalı ton kümeleri',
    detail: 'her sembolde 1–4 ton, her ton 4 bit; ardışık semboller farklı ton kümesinde (MFSK16, ggwave çizgisi)',
  },
  {
    key: 'css',
    num: 2,
    name: 'CSS',
    experimental: true,
    title: 'LoRa tipi chirp yayılı spektrum',
    detail: 'kaydırılmış chirp\'ler, dechirp + FFT; evrişimli kod ve yumuşak kararlı Viterbi (LoRa, Vangelista 2017)',
  },
  {
    key: 'ofdm',
    num: 3,
    name: 'OFDM',
    experimental: true,
    title: 'DQPSK-OFDM, zaman-frekans serpiştirmeli',
    detail: 'onlarca alt taşıyıcıda diferansiyel PSK, bloklar arası atlama (DAB, ETSI EN 300 401)',
  },
  {
    key: 'dsss',
    num: 4,
    name: 'DSSS',
    experimental: true,
    title: 'doğrudan dizili yayılı spektrum',
    detail: 'her bit Barker-11 ya da uzun PN koduyla yayılır, diferansiyel BPSK; RAKE alıcı yankı yollarını toplar, DLL zamanı izler (IEEE 802.11 DSSS; Price ve Green 1958)',
  },
  {
    key: 'janus',
    num: 5,
    name: 'JANUS',
    experimental: true,
    title: 'frekans atlamalı ikili FSK',
    detail: 'her kodlu bit 13 ton çiftinden birinde, bir çift 13 çipte bir çalar; K = 9 evrişimli kod, yankı kuyruğunu toplayan yumuşak kararlı alıcı (NATO STANAG 4748; Potter vd. 2014)',
  },
  {
    key: 'qam',
    num: 6,
    name: 'OFDM-QAM',
    experimental: true,
    title: 'pilotlu, koherent OFDM',
    detail: 'eğitim sembolleri ve 4 pilotla kanal ve faz kestirimi, QPSK/16-QAM, K = 7 evrişimli kod, yumuşak kararlı Viterbi (IEEE 802.11a çizgisi)',
  },
  {
    key: 'ft8',
    num: 7,
    name: 'FT8',
    experimental: true,
    title: '8-GFSK, Costas senkronu ve LDPC',
    detail: '79 sembollük FT8 çerçevesi, Gray kodlu 8-GFSK; LDPC(174, 91) ve inanç yayılımı, alıcıda yankı modelli kafes çözümü (Franke, Somerville ve Taylor 2020)',
  },
];

export const SPEEDS = [
  { key: 'saglam', name: 'Sağlam' },
  { key: 'normal', name: 'Normal' },
  { key: 'hizli', name: 'Hızlı' },
  { key: 'cok-hizli', name: 'Çok hızlı' },
  { key: 'turbo', name: 'Turbo' },
];

// OFDM ortakları: 10 ms'lik yararlı bölüm (100 Hz aralık) + 3,3 ms koruma. Kısa sembol,
// sembolün kendi yankısının yol açtığı taşıyıcılar arası sızmayı azaltır (20 ms'de
// oda koşulunda hata oranı belirgin yüksekti); yankıya asıl dayanıklılığı hop verir.
const OFDM = { mod: 'ofdm', spacing: 100, cpDur: 1 / 300, rollDur: 1 / 1500, gapDur: 0.03, maxBytes: 1024 };

// CSS ortakları: evrişimli iç kod varken dış RS'nin payı küçük tutulur.
const CSS = { mod: 'css', code: 'conv', gapDur: 0.02, fecRatio: 0.1, fecMin: 4, maxBytes: 255 };

// Senkron chirp'leri. Aynı bantta benzer profiller bir chirp'i paylaşır: alıcı her chirp
// için ayrı bir FFT ilintisi yürütür, dinlerken işlemci yükünün çoğu buradan gelir. Hangi
// profil olduğu başlıktaki profil numarasından anlaşılır (paylaşan her profil denenir).
const CHIRPS = {
  saglam: { from: 3650, to: 1450, dur: 0.2 }, // aşağı süpürme, uzun: uzak mesafe
  stdCss: { from: 8300, to: 1700, dur: 0.25 }, // CSS: veri yukarı chirp; senkron uzun aşağı süpürme
  highCss: { from: 17300, to: 11200, dur: 0.2 },
  ultraCss: { from: 20600, to: 17400, dur: 0.2 },
  std: { from: 1500, to: 9000, dur: 0.15 },
  stdOfdm: { from: 10200, to: 1800, dur: 0.1 },
  high: { from: 11300, to: 17200, dur: 0.15 },
  highOfdm: { from: 17200, to: 11300, dur: 0.1 },
  ultra: { from: 17300, to: 20400, dur: 0.15 },
  ultraOfdm: { from: 20400, to: 17400, dur: 0.1 },
};

export const PROFILES = [
  {
    id: 1,
    key: 'saglam',
    name: 'Sağlam',
    band: 'std',
    speed: 'saglam',
    summary: 'uzak mesafe, gürültülü ve çok yankılı ortam; yavaş',
    mod: 'mfsk',
    fStart: 1600,
    toneSpacing: 40,
    channels: 1,
    sets: 3,
    symbolDur: 0.1,
    skipDur: 0.02,
    windowDur: 0.075,
    rampDur: 0.008,
    chirp: CHIRPS.saglam,
    gapDur: 0.06,
    fecRatio: 0.5,
    fecMin: 10,
    maxBytes: 255,
    chunkBytes: 48,
  },
  {
    id: 0,
    key: 'normal',
    name: 'Normal',
    band: 'std',
    speed: 'normal',
    summary: '1–3 m; yankılı odada da güvenilir',
    mod: 'mfsk',
    fStart: 2000,
    toneSpacing: 40,
    channels: 2,
    sets: 4,
    symbolDur: 0.06,
    skipDur: 0.009,
    windowDur: 0.05,
    rampDur: 0.005,
    chirp: CHIRPS.std,
    gapDur: 0.05,
    fecRatio: 0.3,
    fecMin: 8,
    maxBytes: 255,
    chunkBytes: 64,
  },
  {
    id: 2,
    key: 'hizli',
    name: 'Hızlı',
    band: 'std',
    speed: 'hizli',
    summary: 'yakın mesafe (≤ 1 m); Normal’in iki katı hız',
    mod: 'mfsk',
    fStart: 1500,
    toneSpacing: 40,
    channels: 4,
    sets: 3,
    symbolDur: 0.058,
    skipDur: 0.007,
    windowDur: 0.05,
    rampDur: 0.004,
    chirp: CHIRPS.std,
    gapDur: 0.04,
    fecRatio: 0.25,
    fecMin: 8,
    maxBytes: 255,
    chunkBytes: 128,
  },
  {
    ...OFDM,
    id: 10,
    key: 'cok-hizli',
    name: 'Çok hızlı',
    band: 'std',
    speed: 'cok-hizli',
    summary: 'oda içinde ≤ 1 m; görsel ve dosya için',
    fLow: 2000,
    fHigh: 9950,
    psk: 4,
    hop: 8,
    chirp: CHIRPS.stdOfdm,
    fecRatio: 0.3,
    fecMin: 8,
    chunkBytes: 480,
  },
  {
    ...OFDM,
    id: 4,
    key: 'turbo',
    name: 'Turbo',
    band: 'std',
    speed: 'turbo',
    summary: 'cihazlar yakın (≤ 50 cm); en hızlısı',
    fLow: 2000,
    fHigh: 9950,
    psk: 4,
    hop: 3, // 2 blok 750 B/sn verir ama 50 cm'de ve 5 dB SNR'de paketlerin yarısı gidiyordu
    chirp: CHIRPS.stdOfdm,
    fecRatio: 0.3,
    fecMin: 8,
    chunkBytes: 960,
  },
  {
    id: 5,
    key: 'yuksek',
    name: 'Yüksek',
    band: 'high',
    speed: 'normal',
    summary: '1–2 m; Normal’in 11–17 kHz’e taşınmışı',
    mod: 'mfsk',
    fStart: 11600,
    toneSpacing: 40,
    channels: 2,
    sets: 4,
    symbolDur: 0.06,
    skipDur: 0.009,
    windowDur: 0.05,
    rampDur: 0.005,
    chirp: CHIRPS.high,
    gapDur: 0.05,
    fecRatio: 0.3,
    fecMin: 8,
    maxBytes: 255,
    chunkBytes: 64,
  },
  {
    id: 6,
    key: 'yuksek-hizli',
    name: 'Yüksek · Hızlı',
    band: 'high',
    speed: 'hizli',
    summary: 'yakın mesafe (≤ 1 m)',
    mod: 'mfsk',
    fStart: 11400,
    toneSpacing: 40,
    channels: 3,
    sets: 3,
    symbolDur: 0.058,
    skipDur: 0.007,
    windowDur: 0.05,
    rampDur: 0.004,
    chirp: CHIRPS.high,
    gapDur: 0.04,
    fecRatio: 0.25,
    fecMin: 8,
    maxBytes: 255,
    chunkBytes: 96,
  },
  {
    ...OFDM,
    id: 11,
    key: 'yuksek-cok-hizli',
    name: 'Yüksek · Çok hızlı',
    band: 'high',
    speed: 'cok-hizli',
    summary: 'oda içinde ≤ 1 m',
    fLow: 11500,
    fHigh: 16950,
    psk: 2, // dar bantta DQPSK'nin τ belirsizliği hop 6'da saat farkını karşılamıyor
    hop: 6,
    chirp: CHIRPS.highOfdm,
    fecRatio: 0.3,
    fecMin: 8,
    chunkBytes: 192,
  },
  {
    ...OFDM,
    id: 7,
    key: 'yuksek-turbo',
    name: 'Yüksek · Turbo',
    band: 'high',
    speed: 'turbo',
    summary: 'cihazlar yakın (≤ 50 cm)',
    fLow: 11500,
    fHigh: 16950,
    psk: 4,
    hop: 3,
    chirp: CHIRPS.highOfdm,
    fecRatio: 0.3,
    fecMin: 8,
    chunkBytes: 640,
  },
  {
    id: 3,
    key: 'ultrasonik',
    name: 'Ultrasonik',
    band: 'ultra',
    speed: 'normal',
    summary: 'neredeyse duyulmaz; cihaz desteği değişir',
    mod: 'mfsk',
    fStart: 17500,
    toneSpacing: 45,
    channels: 1,
    sets: 3,
    symbolDur: 0.057,
    skipDur: 0.011,
    windowDur: 0.045,
    rampDur: 0.01,
    chirp: CHIRPS.ultra,
    gapDur: 0.05,
    fecRatio: 0.3,
    fecMin: 8,
    maxBytes: 255,
    chunkBytes: 32,
  },
  {
    id: 8,
    key: 'ultra-hizli',
    name: 'Ultrasonik · Hızlı',
    band: 'ultra',
    speed: 'hizli',
    summary: 'yakın mesafe (≤ 1 m); neredeyse duyulmaz',
    mod: 'mfsk',
    fStart: 17500,
    toneSpacing: 45,
    channels: 2,
    sets: 2,
    symbolDur: 0.057,
    skipDur: 0.011,
    windowDur: 0.045,
    rampDur: 0.01,
    chirp: CHIRPS.ultra,
    gapDur: 0.05,
    fecRatio: 0.3,
    fecMin: 8,
    maxBytes: 255,
    chunkBytes: 64,
  },
  {
    ...OFDM,
    id: 9,
    key: 'ultra-turbo',
    name: 'Ultrasonik · Turbo',
    band: 'ultra',
    speed: 'turbo',
    summary: 'cihazlar yan yana (≤ 30 cm); neredeyse duyulmaz',
    fLow: 17600,
    fHigh: 20350,
    psk: 4,
    hop: 2,
    chirp: CHIRPS.ultraOfdm,
    fecRatio: 0.3,
    fecMin: 8,
    chunkBytes: 320,
  },
  {
    ...CSS,
    id: 12,
    key: 'css-saglam',
    name: 'CSS · Sağlam',
    band: 'std',
    speed: 'saglam',
    summary: 'en uzun menzil, gürültü ve yankıda en dayanıklı; cihazlar sabit dururken',
    fLow: 2000,
    fHigh: 8000,
    sf: 10,
    chirp: CHIRPS.stdCss,
    chunkBytes: 24,
  },
  {
    ...CSS,
    id: 13,
    key: 'css-normal',
    name: 'CSS · Normal',
    band: 'std',
    speed: 'normal',
    summary: 'uzak mesafe ve gürültülü ortam',
    fLow: 2000,
    fHigh: 8000,
    sf: 8,
    chirp: CHIRPS.stdCss,
    chunkBytes: 64,
  },
  {
    ...CSS,
    id: 14,
    key: 'css-hizli',
    name: 'CSS · Hızlı',
    band: 'std',
    speed: 'hizli',
    summary: 'oda içi, birkaç metre',
    fLow: 2000,
    fHigh: 8000,
    sf: 7,
    chirp: CHIRPS.stdCss,
    chunkBytes: 96,
  },
  {
    ...CSS,
    id: 15,
    key: 'css-yuksek',
    name: 'CSS · Yüksek',
    band: 'high',
    speed: 'normal',
    summary: 'uzak mesafe; daha az duyulur',
    fLow: 11500,
    fHigh: 17000,
    sf: 8,
    chirp: CHIRPS.highCss,
    chunkBytes: 64,
  },
  {
    ...CSS,
    id: 16,
    key: 'css-yuksek-hizli',
    name: 'CSS · Yüksek · Hızlı',
    band: 'high',
    speed: 'hizli',
    summary: 'oda içi; daha az duyulur',
    fLow: 11500,
    fHigh: 17000,
    sf: 7,
    chirp: CHIRPS.highCss,
    chunkBytes: 96,
  },
  {
    ...CSS,
    id: 17,
    key: 'css-ultra',
    name: 'CSS · Ultrasonik',
    band: 'ultra',
    speed: 'normal',
    summary: 'neredeyse duyulmaz; birkaç metre, cihazlar sabit dururken',
    fLow: 17600,
    fHigh: 20400,
    sf: 8,
    chirp: CHIRPS.ultraCss,
    chunkBytes: 32,
  },
  {
    ...CSS,
    id: 18,
    key: 'css-ultra-hizli',
    name: 'CSS · Ultrasonik · Hızlı',
    band: 'ultra',
    speed: 'hizli',
    summary: 'neredeyse duyulmaz; oda içi',
    fLow: 17600,
    fHigh: 20400,
    sf: 7,
    chirp: CHIRPS.ultraCss,
    chunkBytes: 48,
  },
  // ---- Mod 4 · DSSS (id 20–29, anahtar dsss-…)
  {
    id: 20,
    key: 'dsss-saglam',
    name: 'DSSS · Sağlam',
    band: 'std',
    speed: 'saglam',
    summary: 'çok uzak ve çok yankılı salon, gürültü sinyalden güçlü; yavaş',
    mod: 'dsss',
    code: 'conv',
    fLow: 2000,
    fHigh: 8000,
    pn: 'prbs15',
    chips: 63,
    chirp: CHIRPS.stdCss,
    gapDur: 0.02,
    fecRatio: 0.1,
    fecMin: 4,
    maxBytes: 255,
    chunkBytes: 24,
    sim: {
      label: 'çok uzak, yankılı salon, gürültü sinyalden 8 dB güçlü',
      channel: { rt60: 1.0, drr: -8, snr: -8 },
    },
  },
  {
    id: 21,
    key: 'dsss-normal',
    name: 'DSSS · Normal',
    band: 'std',
    speed: 'normal',
    summary: 'gürültülü ortam, uzak oda; cihazlar hareket ederken de',
    mod: 'dsss',
    code: 'conv',
    fLow: 2000,
    fHigh: 8000,
    pn: 'prbs15',
    chips: 31,
    chirp: CHIRPS.stdCss,
    gapDur: 0.02,
    fecRatio: 0.1,
    fecMin: 4,
    maxBytes: 255,
    chunkBytes: 48,
    sim: {
      label: 'uzak oda, elde sallama, gürültü sinyalden 5 dB güçlü',
      channel: { rt60: 0.6, drr: -5, snr: -5, motion: { amp: 0.03, freq: 0.7 } },
    },
  },
  {
    id: 22,
    key: 'dsss-hizli',
    name: 'DSSS · Hızlı',
    band: 'std',
    speed: 'hizli',
    summary: 'oda içi, birkaç metre; 802.11 gibi Barker-11',
    mod: 'dsss',
    code: 'conv',
    fLow: 2000,
    fHigh: 8000,
    pn: 'barker11',
    chirp: CHIRPS.stdCss,
    gapDur: 0.02,
    fecRatio: 0.1,
    fecMin: 4,
    maxBytes: 255,
    chunkBytes: 96,
    sim: {
      label: 'yankılı oda, gürültü sinyal kadar güçlü',
      channel: { rt60: 0.5, drr: 0, snr: 0 },
    },
  },
  {
    id: 23,
    key: 'dsss-ultra-hizli',
    name: 'DSSS · Ultrasonik · Hızlı',
    band: 'ultra',
    speed: 'hizli',
    summary: 'neredeyse duyulmaz; oda içi, elde tutarken de',
    mod: 'dsss',
    code: 'conv',
    fLow: 17600,
    fHigh: 20400,
    pn: 'barker11',
    chirp: CHIRPS.ultraCss,
    gapDur: 0.02,
    fecRatio: 0.1,
    fecMin: 4,
    maxBytes: 255,
    chunkBytes: 64,
    sim: {
      label: 'oda içi, elde sallama, 100 ppm saat farkı',
      channel: { rt60: 0.45, drr: 3, snr: 5, motion: { amp: 0.03, freq: 0.7 }, ppm: 100 },
    },
  },
  // ---- Mod 5 · JANUS (id 30–39, anahtar janus-…)
  // Ton n = 2 · çift + bit, f = fLow + n · toneSpacing (26 ton). Çip (sembol) chipDur; bir çift 13 çipte bir
  // çalar, yankı yaşı 12 · chipDur (Sağlam 240 ms, Normal 120 ms). Ton aralığı ≥ 2,3 / chipDur (Hann).
  {
    id: 30,
    key: 'janus-saglam',
    name: 'JANUS · Sağlam',
    band: 'std',
    speed: 'saglam',
    summary: 'çok yankılı salon, uzak mesafe, gürültü sinyalden güçlü; elde tutarken de; en yavaşı',
    mod: 'janus',
    code: 'conv9',
    fLow: 1800,
    toneSpacing: 250,
    chipDur: 0.02,
    chirp: CHIRPS.stdCss,
    gapDur: 0.02,
    fecRatio: 0.1,
    fecMin: 4,
    maxBytes: 255,
    sim: {
      label: 'kilise gibi çok yankılı salon (RT60 2 s), çok uzak',
      channel: { rt60: 2.0, drr: -15, snr: 5 },
    },
    chunkBytes: 24,
  },
  {
    id: 31,
    key: 'janus-normal',
    name: 'JANUS · Normal',
    band: 'std',
    speed: 'normal',
    summary: 'yankılı salon ve uzak mesafe; cihazlar hareket etse de',
    mod: 'janus',
    code: 'conv9',
    fLow: 1800,
    toneSpacing: 250,
    chipDur: 0.01,
    chirp: CHIRPS.stdCss,
    gapDur: 0.02,
    fecRatio: 0.1,
    fecMin: 4,
    maxBytes: 255,
    sim: {
      label: 'uzak, yankılı salon (RT60 1 s), gürültü sinyal kadar güçlü',
      channel: { rt60: 1.0, drr: -8, snr: 0 },
    },
    chunkBytes: 48,
  },
  {
    id: 32,
    key: 'janus-yuksek',
    name: 'JANUS · Yüksek',
    band: 'high',
    speed: 'normal',
    summary: 'yankılı salon ve uzak mesafe; daha az duyulur',
    mod: 'janus',
    code: 'conv9',
    fLow: 11300,
    toneSpacing: 230,
    chipDur: 0.01,
    chirp: CHIRPS.highCss,
    gapDur: 0.02,
    fecRatio: 0.1,
    fecMin: 4,
    maxBytes: 255,
    sim: {
      label: 'uzak, yankılı salon (RT60 1 s), gürültü sinyal kadar güçlü',
      channel: { rt60: 1.0, drr: -8, snr: 0 },
    },
    chunkBytes: 48,
  },
  {
    id: 33,
    key: 'janus-ultra',
    name: 'JANUS · Ultrasonik',
    band: 'ultra',
    speed: 'saglam',
    summary: 'neredeyse duyulmaz; yankılı odada ve elde tutarken; yavaş',
    mod: 'janus',
    code: 'conv9',
    fLow: 17500,
    toneSpacing: 115,
    chipDur: 0.02,
    chirp: CHIRPS.ultraCss,
    gapDur: 0.02,
    fecRatio: 0.1,
    fecMin: 4,
    maxBytes: 255,
    sim: {
      label: 'uzak, yankılı oda (RT60 0,8 s), gürültü sinyal kadar güçlü',
      channel: { rt60: 0.8, drr: -5, snr: 0 },
    },
    chunkBytes: 24,
  },
  // ---- Mod 6 · OFDM-QAM (id 40–49, anahtar qam-…)
  // Mod 3 ile aynı ızgara (100 Hz, 10 ms + 3,3 ms koruma), bkz. mod/qam.js. K = 7 evrişimli iç kod
  // varken dış RS'nin payı küçük; 1024 baytlık paketler görsel/dosya parçaları için.
  {
    id: 40,
    key: 'qam-turbo',
    name: 'OFDM-QAM · Turbo',
    band: 'std',
    speed: 'turbo',
    summary: 'cihazlar yan yana (≤ 20 cm), sessiz ortam; en hızlısı',
    mod: 'qam',
    code: 'conv',
    spacing: 100,
    cpDur: 1 / 300,
    rollDur: 1 / 1500,
    fLow: 2000,
    fHigh: 9950,
    qam: 16,
    hop: 1, // yankı CP'yi aşınca girişim ≈ DRR: 16-QAM'e ~12 dB gerekir, yalnız çok yakında
    crest: 2, // tepe/RMS (Mod 3: 2,3): aynı tepede ~1,2 dB yüksek ortalama güç, kırpma gürültüsü ~−32 dB
    chirp: CHIRPS.stdOfdm,
    gapDur: 0.03,
    fecRatio: 0.1,
    fecMin: 4,
    maxBytes: 1024,
    chunkBytes: 1000,
    sim: { label: 'yan yana, hafif yankı', channel: { rt60: 0.4, drr: 15, snr: 20 } },
  },
  {
    id: 41,
    key: 'qam-cok-hizli',
    name: 'OFDM-QAM · Çok hızlı',
    band: 'std',
    speed: 'cok-hizli',
    summary: 'cihazlar yakın (≤ 50 cm); görsel ve dosya için',
    mod: 'qam',
    code: 'conv',
    spacing: 100,
    cpDur: 1 / 300,
    rollDur: 1 / 1500,
    fLow: 2000,
    fHigh: 9950,
    qam: 4,
    hop: 1, // aynı hızda 16-QAM + 2 blok da denendi: gürültüde daha zayıf
    chirp: CHIRPS.stdOfdm,
    gapDur: 0.03,
    fecRatio: 0.1,
    fecMin: 4,
    maxBytes: 1024,
    chunkBytes: 960,
    sim: { label: '50 cm, yankılı oda', channel: { rt60: 0.5, drr: 6, snr: 20 } },
  },
  {
    id: 42,
    key: 'qam-hizli',
    name: 'OFDM-QAM · Hızlı',
    band: 'std',
    speed: 'hizli',
    summary: 'oda içinde ≤ 1 m; yankıda ve gürültüde daha sağlam',
    mod: 'qam',
    code: 'conv',
    spacing: 100,
    cpDur: 1 / 300,
    rollDur: 1 / 1500,
    fLow: 2000,
    fHigh: 9950,
    qam: 4,
    hop: 3, // bir taşıyıcı 40 ms sonra yeniden çalar; DRR 0 dB'lik odada da çözüldü
    chirp: CHIRPS.stdOfdm,
    gapDur: 0.03,
    fecRatio: 0.1,
    fecMin: 4,
    maxBytes: 1024,
    chunkBytes: 480,
    sim: { label: '1 m, yankılı oda + gürültü', channel: { rt60: 0.5, drr: 0, snr: 10 } },
  },
  {
    id: 43,
    key: 'qam-yuksek-cok-hizli',
    name: 'OFDM-QAM · Yüksek · Çok hızlı',
    band: 'high',
    speed: 'cok-hizli',
    summary: 'cihazlar yakın (≤ 50 cm); daha az duyulur',
    mod: 'qam',
    code: 'conv',
    spacing: 100,
    cpDur: 1 / 300,
    rollDur: 1 / 1500,
    fLow: 11500,
    fHigh: 16950,
    qam: 4,
    hop: 1,
    chirp: CHIRPS.highOfdm,
    gapDur: 0.03,
    fecRatio: 0.1,
    fecMin: 4,
    maxBytes: 1024,
    chunkBytes: 720,
    sim: { label: '50 cm, yankılı oda', channel: { rt60: 0.5, drr: 6, snr: 20 } },
  },
  // ---- Mod 7 · FT8 (id 50–59, anahtar ft8-…)
  // FT8 (bkz. mod/ft8.js): symbolDur = T, ton aralığı 1 / T (h = 1); subchannels adet eş zamanlı
  // FT8 sinyali, her biri 8 ton + 2 ton boşluk. Yankılı odada T = 80 ms, 40 ms'den belirgin iyi.
  // Paket süresi 79 sembollük çerçevenin katıdır; chunkBytes (+ 5 bayt parça başlığı) 2 çerçeveye sığar.
  {
    id: 50,
    key: 'ft8-saglam',
    name: 'FT8 · Sağlam',
    band: 'std',
    speed: 'saglam',
    summary: 'çok düşük SNR ve uzak mesafe; en yavaşı',
    mod: 'ft8',
    code: 'ldpc',
    symbolDur: 0.08,
    subchannels: 2,
    fBase: 4000,
    chirp: CHIRPS.stdCss,
    gapDur: 0.04,
    fecRatio: 0.15,
    fecMin: 6,
    maxBytes: 255,
    chunkBytes: 19,
    sim: { label: 'yankılı oda, gürültü sinyalden 8 dB güçlü', channel: { rt60: 0.5, drr: 0, snr: -8 } },
  },
  {
    id: 51,
    key: 'ft8-normal',
    name: 'FT8 · Normal',
    band: 'std',
    speed: 'normal',
    summary: 'düşük SNR, gürültülü ortam; çok yankılı salonda zorlanır',
    mod: 'ft8',
    code: 'ldpc',
    symbolDur: 0.08,
    subchannels: 4,
    fBase: 4000,
    chirp: CHIRPS.stdCss,
    gapDur: 0.04,
    fecRatio: 0.15,
    fecMin: 6,
    maxBytes: 255,
    chunkBytes: 59,
    sim: { label: 'yankılı oda, gürültü sinyalden 5 dB güçlü', channel: { rt60: 0.5, drr: 0, snr: -5 } },
  },
  {
    id: 52,
    key: 'ft8-hizli',
    name: 'FT8 · Hızlı',
    band: 'std',
    speed: 'hizli',
    summary: 'oda içi, birkaç metre; gürültü sinyalden en çok 10 dB güçlü',
    mod: 'ft8',
    code: 'ldpc',
    symbolDur: 0.04,
    subchannels: 3,
    fBase: 4000,
    chirp: CHIRPS.stdCss,
    gapDur: 0.04,
    fecRatio: 0.15,
    fecMin: 6,
    maxBytes: 255,
    chunkBytes: 39,
    sim: { label: 'yankılı oda + gürültü', channel: { rt60: 0.45, drr: 0, snr: 0 } },
  },
  {
    id: 53,
    key: 'ft8-yuksek',
    name: 'FT8 · Yüksek',
    band: 'high',
    speed: 'normal',
    summary: 'düşük SNR, oda içi; daha az duyulur',
    mod: 'ft8',
    code: 'ldpc',
    symbolDur: 0.04, // 80 ms'de ton aralığı 12,5 Hz: 13 kHz'de sallamanın Doppler'i yarım tona yaklaşıyor
    subchannels: 3,
    fBase: 13500,
    chirp: CHIRPS.highCss,
    gapDur: 0.04,
    fecRatio: 0.15,
    fecMin: 6,
    maxBytes: 255,
    chunkBytes: 39,
    sim: { label: 'yankılı oda, gürültü sinyal kadar güçlü', channel: { rt60: 0.45, drr: 0, snr: 0 } },
  },
];

export const PROFILE_BY_KEY = Object.fromEntries(PROFILES.map((p) => [p.key, p]));

export function getProfile(key) {
  const p = PROFILE_BY_KEY[key];
  if (!p) throw new Error(`bilinmeyen profil: ${key}`);
  return p;
}

// Mod 4–7: <mod>Info(p) → { T, lo, hi, codedBitRate }.
const MOD_INFO = { dsss: dsssInfo, janus: janusInfo, qam: qamInfo, ft8: ft8Info };

export function findProfile(mode, band, speed) {
  return PROFILES.find((p) => p.mod === mode && p.band === band && p.speed === speed) ?? null;
}

export function toneFrequency(p, channel, set, value) {
  return p.fStart + p.toneSpacing * (channel * p.sets * VALUES_PER_TONE + value * p.sets + set);
}

const ofdmCache = new WeakMap();

/**
 * Blokların çalma sırası: ardışık semboller mümkünse komşu olmayan bloklara düşsün (bir
 * önceki sembolün yankısı ve kesik yansımaları, çözülen bloğa en az bir blok uzaktan
 * sızar). Döngüsel sıra geri izlemeyle bulunur; 3 ve 4 blokta böyle bir sıra yoktur.
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

/**
 * OFDM taşıyıcıları ve sembol düzeni (profil başına bir kez hesaplanır).
 * hop > 1 ise taşıyıcılar hop bitişik bloğa bölünür ve her sembolde yalnız bir blok
 * çalar; bir taşıyıcı ancak hop sembol sonra yeniden duyulur (MFSK'deki ton kümeleri gibi).
 */
export function ofdmInfo(p) {
  let info = ofdmCache.get(p);
  if (!info) {
    const bits = Math.log2(p.psk);
    const per = 4 / bits; // bir nibble'ı taşıyan taşıyıcı sayısı
    const L = p.hop ?? 1;
    const k0 = Math.ceil(p.fLow / p.spacing - 1e-9);
    const k1 = Math.floor(p.fHigh / p.spacing + 1e-9);
    const Kb = Math.floor((k1 - k0 + 1) / (L * per)) * per; // blok başına taşıyıcı
    const K = Kb * L;
    const freqs = Float64Array.from({ length: K }, (_, i) => (k0 + i) * p.spacing);
    const Tu = 1 / p.spacing;
    // Başlığın her birimi en az bir taşıyıcıya düşsün: gerekirse bloklar birkaç tur döner.
    const headerSymbols = L * Math.ceil((HEADER_NIBBLES * per) / K);
    info = { freqs, K, Kb, L, order: blockOrder(L), bits, per, nibbles: Kb / per, headerSymbols, Tu, Ts: Tu + p.cpDur };
    ofdmCache.set(p, info);
  }
  return info;
}

/** Bir sembolün süresi (s). */
export function symbolDuration(p) {
  if (p.mod === 'ofdm') return ofdmInfo(p).Ts;
  if (p.mod === 'css') return cssInfo(p).T;
  if (MOD_INFO[p.mod]) return MOD_INFO[p.mod](p).T;
  return p.symbolDur;
}

/** Profilin kapladığı frekans aralığı (spektrogram işaretleri ve süzgeçler için). */
export function profileBand(p) {
  let lo;
  let hi;
  if (p.mod === 'ofdm') {
    const f = ofdmInfo(p).freqs;
    lo = f[0];
    hi = f[f.length - 1];
  } else if (p.mod === 'css') {
    lo = p.fLow;
    hi = p.fHigh;
  } else if (MOD_INFO[p.mod]) {
    ({ lo, hi } = MOD_INFO[p.mod](p));
  } else {
    lo = p.fStart;
    hi = toneFrequency(p, p.channels - 1, p.sets - 1, VALUES_PER_TONE - 1);
  }
  return {
    lo: Math.min(lo, p.chirp.from, p.chirp.to),
    hi: Math.max(hi, p.chirp.from, p.chirp.to),
  };
}

/** Örnekleme hızı bu profilin en yüksek frekansını taşıyabiliyor mu (Nyquist payıyla)? */
export function supportsProfile(profile, fs) {
  return profileBand(profile).hi < 0.48 * fs;
}

/** Ham bit hızı (bayt/sn), hata düzeltme payı hariç. */
export function rawByteRate(p) {
  if (p.mod === 'ofdm') {
    const { Kb, bits, Ts } = ofdmInfo(p);
    return (Kb * bits) / 8 / Ts;
  }
  if (p.mod === 'css') return p.sf / 8 / cssInfo(p).T;
  if (MOD_INFO[p.mod]) return MOD_INFO[p.mod](p).codedBitRate / 8;
  return (p.channels * 4) / 8 / p.symbolDur;
}

/**
 * Net bilgi hızı (bayt/sn): ham hız × iç kod oranı × RS oranı. Paket başı yük (senkron,
 * başlık) hariç; yöntemleri karşılaştırmak için ham hızdan daha dürüst.
 */
export function netByteRate(p) {
  return (rawByteRate(p) * (innerCode(p)?.rate ?? 1)) / (1 + p.fecRatio);
}
