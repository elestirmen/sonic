// Kanal koşullarına göre paket başarı oranı tablosu.
//   node test/bench.js [--trials 20] [--profile normal,hizli] [--bytes 400]
// --bytes verilirse kelimelerden kısa metin yerine o uzunlukta rastgele veri gönderilir.

import { encodeMessage } from '../public/src/modem.js';
import { PROFILES, getProfile, profileBand } from '../public/src/profiles.js';
import { rng, simulateChannel } from '../public/src/dsp/channel.js';
import { decodeSamples, messages } from './helpers.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const trials = Number(args.trials ?? 20);
const fixedBytes = args.bytes ? Number(args.bytes) : 0;
const profiles = args.profile ? args.profile.split(',').map(getProfile) : PROFILES;

const WORDS = 'merhaba dünya sonik ses dalga mesaj çözüm şifre ağaç göl ırmak üzüm kapadokya ürgüp balon peri bacası'.split(' ');
const phone = { lowCut: 400, eq: [{ f: 2500, gainDb: 6 }, { f: 3800, gainDb: -8 }, { f: 6000, gainDb: 5 }] };

const CONDITIONS = [
  { name: 'temiz', opts: {} },
  { name: 'SNR 10 dB', opts: { snr: 10 } },
  { name: 'SNR 5 dB', opts: { snr: 5 } },
  { name: 'SNR 0 dB', opts: { snr: 0 } },
  { name: 'SNR −5 dB', opts: { snr: -5 } },
  { name: 'yan yana (RT60 0.4, DRR +15)', opts: { rt60: 0.4, drr: 15, snr: 20 } },
  { name: 'yakın (RT60 0.3, DRR +10)', opts: { rt60: 0.3, drr: 10, snr: 15 } },
  { name: '50 cm (RT60 0.5, DRR +6)', opts: { rt60: 0.5, drr: 6, snr: 20 } },
  { name: 'oda (RT60 0.5, DRR 0)', opts: { rt60: 0.5, drr: 0, snr: 15 } },
  { name: 'uzak (RT60 0.6, DRR −5)', opts: { rt60: 0.6, drr: -5, snr: 15 } },
  { name: 'yankılı salon (RT60 1.0, DRR −8)', opts: { rt60: 1.0, drr: -8, snr: 15 } },
  { name: 'telefon hoparlörü + oda', opts: { ...phone, rt60: 0.5, drr: 0, snr: 15 } },
  { name: 'konuşma girişimi 0 dB', opts: { babble: 0, rt60: 0.3, drr: 5 } },
  { name: '44.1→48 kHz, +120 ppm, oda', opts: { fsOut: 48000, ppm: 120, rt60: 0.5, drr: 0, snr: 15 } },
];

function randomMessage(rand, maxBytes) {
  if (fixedBytes) return Uint8Array.from({ length: Math.min(fixedBytes, maxBytes) }, () => Math.floor(rand() * 256));
  const n = 4 + Math.floor(rand() * 5);
  return new TextEncoder().encode(Array.from({ length: n }, () => WORDS[Math.floor(rand() * WORDS.length)]).join(' '));
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const rows = [];
let audioSeconds = 0;
let cpuMs = 0;
for (const cond of CONDITIONS) {
  const row = { name: cond.name };
  for (const p of profiles) {
    const band = profileBand(p);
    let ok = 0;
    for (let t = 0; t < trials; t++) {
      const rand = rng(1000 * t + 17);
      const msg = randomMessage(rand, p.maxBytes);
      const fsTx = cond.opts.fsOut ? 44100 : 48000;
      const { samples } = encodeMessage(msg, p.key, fsTx);
      const rx = simulateChannel(samples, fsTx, {
        ...cond.opts,
        noiseBand: [Math.max(200, band.lo * 0.5), Math.min(22000, band.hi * 1.5)],
        delay: 0.1 + rand() * 0.5,
        seed: t + 1,
      });
      const fsRx = cond.opts.fsOut ?? fsTx;
      const t0 = performance.now();
      const got = messages(decodeSamples(rx, fsRx, { profiles: [p] }));
      cpuMs += performance.now() - t0;
      audioSeconds += rx.length / fsRx;
      if (got.length === 1 && same(got[0].bytes, msg)) ok++;
    }
    row[p.key] = Math.round((100 * ok) / trials);
  }
  rows.push(row);
  console.error(`… ${cond.name}`);
}

console.log(`\n${trials} deneme/hücre, paket başarı oranı (%). SNR = bant içi.\n`);
console.log(`| Koşul | ${profiles.map((p) => p.name).join(' | ')} |`);
console.log(`|---|${profiles.map(() => '---:').join('|')}|`);
for (const r of rows) console.log(`| ${r.name} | ${profiles.map((p) => r[p.key]).join(' | ')} |`);
console.log(`\nÇözme hızı: gerçek zamanın ${(audioSeconds / (cpuMs / 1000)).toFixed(0)}× hızı (tek profil, tek çekirdek)`);
