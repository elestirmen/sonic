import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMessage, estimateDuration } from '../public/src/modem.js';
import { PROFILES, getProfile } from '../public/src/profiles.js';
import { gaussian, rng, simulateChannel } from '../public/src/dsp/channel.js';
import { decodeWav, encodeWav } from '../public/src/audio/wav.js';
import { bytes, concat, decodeSamples, messages, text } from './helpers.js';

const SAMPLE = 'Merhaba dünya! Çığ, şöyle; ünlü Ömer 123 🙂';

for (const p of PROFILES) {
  for (const fs of [48000, 44100]) {
    test(`temiz döngü: ${p.key} @ ${fs} Hz`, () => {
      const { samples } = encodeMessage(bytes(SAMPLE), p.key, fs);
      const got = messages(decodeSamples(samples, fs, { profiles: [p] }));
      assert.equal(got.length, 1);
      assert.equal(text(got[0].bytes), SAMPLE);
      assert.equal(got[0].profile, p.key);
      assert.equal(got[0].stats.corrected, 0);
    });
  }
}

test('süre tahmini gerçek dalga formuyla uyumlu', () => {
  for (const p of PROFILES) {
    const { duration } = encodeMessage(bytes(SAMPLE), p.key, 48000);
    assert.ok(Math.abs(duration - estimateDuration(bytes(SAMPLE).length, p)) < 0.002);
  }
});

test('profil otomatik tanınır (tüm dedektörler açık)', () => {
  for (const p of PROFILES) {
    const { samples } = encodeMessage(bytes(`profil ${p.name}`), p.key, 48000);
    const got = messages(decodeSamples(samples, 48000));
    assert.equal(got.length, 1, p.key);
    assert.equal(got[0].profile, p.key);
    assert.equal(text(got[0].bytes), `profil ${p.name}`);
  }
});

test('44.1 kHz verici → 48 kHz alıcı, +80 ppm saat kayması, gecikme', () => {
  const { samples } = encodeMessage(bytes(SAMPLE), 'normal', 44100);
  const rx = simulateChannel(samples, 44100, { fsOut: 48000, ppm: 80, delay: 0.37, seed: 3 });
  const got = messages(decodeSamples(rx, 48000, { profiles: [getProfile('normal')] }));
  assert.equal(got.length, 1);
  assert.equal(text(got[0].bytes), SAMPLE);
});

test('akış parçalanması sonucu değiştirmez', () => {
  const { samples } = encodeMessage(bytes(SAMPLE), 'hizli', 48000);
  const noisy = simulateChannel(samples, 48000, { snr: 15, noiseBand: [1000, 12000], delay: 0.2, seed: 9 });
  const a = messages(decodeSamples(noisy, 48000, { chunk: 128 }));
  const b = messages(decodeSamples(noisy, 48000, { chunk: 5000, rand: rng(5) }));
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.deepEqual(a[0].bytes, b[0].bytes);
});

test('en uzun mesaj (255 bayt, çok bloklu RS)', () => {
  const msg = new Uint8Array(255).map((_, i) => (i * 37 + 11) & 255);
  for (const key of ['normal', 'hizli']) {
    const { samples } = encodeMessage(msg, key, 48000);
    const rx = simulateChannel(samples, 48000, { snr: 12, noiseBand: [1000, 12000], seed: 4 });
    const got = messages(decodeSamples(rx, 48000, { profiles: [getProfile(key)] }));
    assert.equal(got.length, 1, key);
    assert.deepEqual(got[0].bytes, msg);
  }
});

test('ardışık iki paket ayrı ayrı çözülür', () => {
  const a = encodeMessage(bytes('birinci mesaj'), 'normal', 48000).samples;
  const b = encodeMessage(bytes('ikinci mesaj'), 'normal', 48000).samples;
  const stream = simulateChannel(concat(a, b), 48000, { snr: 15, noiseBand: [1000, 8000], rt60: 0.3, drr: 6, seed: 2 });
  const got = messages(decodeSamples(stream, 48000));
  assert.deepEqual(got.map((m) => text(m.bytes)), ['birinci mesaj', 'ikinci mesaj']);
});

test('yankılı ve gürültülü oda (RT60 0.5 s, DRR 0 dB, SNR 10 dB)', () => {
  const { samples } = encodeMessage(bytes(SAMPLE), 'normal', 48000);
  let ok = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const rx = simulateChannel(samples, 48000, { rt60: 0.5, drr: 0, snr: 10, noiseBand: [1000, 8000], seed });
    const got = messages(decodeSamples(rx, 48000, { profiles: [getProfile('normal')] }));
    if (got.length === 1 && text(got[0].bytes) === SAMPLE) ok++;
  }
  assert.ok(ok >= 4, `5 denemeden ${ok} başarılı`);
});

test('yalnız gürültü: sahte mesaj üretmez', () => {
  const rand = rng(77);
  const fs = 48000;
  const noise = new Float32Array(60 * fs);
  for (let i = 0; i < noise.length; i++) noise[i] = 0.1 * gaussian(rand);
  const events = decodeSamples(noise, fs);
  assert.equal(messages(events).length, 0);
  assert.ok(events.filter((e) => e.type === 'sync').length <= 1);
});

test('OFDM: 44.1 kHz verici → 48 kHz alıcı, ±150 ppm saat farkı, en uzun paket', () => {
  const msg = new Uint8Array(1024).map((_, i) => (i * 131 + 7) & 255);
  for (const [key, ppm] of [
    ['turbo', 150],
    ['cok-hizli', -150],
    ['yuksek-turbo', 120],
    ['yuksek-cok-hizli', -120],
    ['ultra-turbo', 100],
  ]) {
    const { samples } = encodeMessage(msg, key, 44100);
    const rx = simulateChannel(samples, 44100, { fsOut: 48000, ppm, rt60: 0.3, drr: 15, snr: 25, noiseBand: [1000, 21000], delay: 0.2, seed: 8 });
    const got = messages(decodeSamples(rx, 48000, { profiles: [getProfile(key)] }));
    assert.equal(got.length, 1, key);
    assert.deepEqual(got[0].bytes, msg, key);
  }
});

test('Turbo: yan yana (RT60 0.4 s, DRR +12 dB, SNR 20 dB)', () => {
  const msg = new Uint8Array(900).map((_, i) => (i * 17) & 255);
  const { samples } = encodeMessage(msg, 'turbo', 48000);
  let ok = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const rx = simulateChannel(samples, 48000, { rt60: 0.4, drr: 12, snr: 20, noiseBand: [1000, 15000], seed });
    const got = messages(decodeSamples(rx, 48000, { profiles: [getProfile('turbo')] }));
    if (got.length === 1 && got[0].bytes.every((v, i) => v === msg[i])) ok++;
  }
  assert.ok(ok >= 4, `5 denemeden ${ok} başarılı`);
});

test('Çok hızlı: yankılı oda (RT60 0.5 s, DRR 0 dB, SNR 15 dB)', () => {
  const msg = bytes(SAMPLE.repeat(4));
  const { samples } = encodeMessage(msg, 'cok-hizli', 48000);
  let ok = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const rx = simulateChannel(samples, 48000, { rt60: 0.5, drr: 0, snr: 15, noiseBand: [1000, 15000], seed });
    const got = messages(decodeSamples(rx, 48000, { profiles: [getProfile('cok-hizli')] }));
    if (got.length === 1 && text(got[0].bytes) === SAMPLE.repeat(4)) ok++;
  }
  assert.ok(ok >= 4, `5 denemeden ${ok} başarılı`);
});

/** Bir profilin, kanal koşulunda n denemeden kaçını çözdüğü (kelime mesajlarıyla). */
function success(key, channel, n = 4) {
  const p = getProfile(key);
  let ok = 0;
  for (let seed = 1; seed <= n; seed++) {
    const msg = `deneme ${seed}: ${SAMPLE}`;
    const { samples } = encodeMessage(bytes(msg), key, channel.fsIn ?? 48000);
    const rx = simulateChannel(samples, channel.fsIn ?? 48000, { ...channel, seed });
    const got = messages(decodeSamples(rx, channel.fsOut ?? channel.fsIn ?? 48000, { profiles: [p] }));
    if (got.length === 1 && text(got[0].bytes) === msg) ok++;
  }
  return ok;
}

test('CSS: çok düşük SNR (−15 dB) ve çok uzak yankılı salonda MFSK Normal çözemezken CSS Normal çözer', () => {
  const noisy = { snr: -15, noiseBand: [850, 12500], delay: 0.2 };
  assert.ok(success('css-normal', noisy) >= 3, 'CSS Normal −15 dB');
  assert.ok(success('normal', noisy) <= 1, 'MFSK Normal −15 dB beklenenden iyi: test koşulu eskidi mi?');
  assert.ok(success('css-normal', { rt60: 1.2, drr: -12, snr: 5, noiseBand: [850, 12500] }) >= 3, 'CSS Normal çok uzak');
});

test('CSS: elde titreme, sabit hızla yaklaşma ve 44,1 → 48 kHz +120 ppm', () => {
  const room = { rt60: 0.5, drr: 0, snr: 15, noiseBand: [850, 12500] };
  assert.ok(success('css-normal', { ...room, motion: { amp: 0.01, freq: 0.5 } }) >= 3, 'titreme');
  assert.ok(success('css-hizli', { ...room, motion: { speed: -0.1 } }) >= 3, 'yaklaşma');
  assert.ok(success('css-normal', { fsIn: 44100, fsOut: 48000, ppm: 120, rt60: 0.6, drr: -5, snr: 15, noiseBand: [850, 12500] }) >= 3, 'ppm');
});

test('WAV yaz → oku → çöz', () => {
  const { samples } = encodeMessage(bytes(SAMPLE), 'normal', 44100);
  const wav = decodeWav(encodeWav(samples, 44100));
  assert.equal(wav.sampleRate, 44100);
  const got = messages(decodeSamples(wav.samples, wav.sampleRate));
  assert.equal(text(got[0].bytes), SAMPLE);
});
