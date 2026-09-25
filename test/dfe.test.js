import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPacket, encodeMessage } from '../public/src/modem.js';
import { PRE_SILENCE, getProfile, profileBand } from '../public/src/profiles.js';
import { simulateChannel } from '../public/src/dsp/channel.js';
import { SampleStore } from '../public/src/dsp/store.js';
import { DfeDemod, dfeInfo } from '../public/src/mod/dfe.js';
import { bytes, decodeSamples, messages, text } from './helpers.js';

/** n denemeden kaçında mesaj doğru çözülür (her denemede farklı tohum ve metin). */
function success(key, channel, n = 4, body = 'Sonik SC-DFE; tek taşıyıcı, uyarlamalı eşitleyici.') {
  const p = getProfile(key);
  const band = profileBand(p);
  const fsIn = channel.fsIn ?? 48000;
  let ok = 0;
  for (let seed = 1; seed <= n; seed++) {
    const msg = `${seed}: ${body.repeat(4)}`;
    const { samples } = encodeMessage(bytes(msg), key, fsIn);
    const rx = simulateChannel(samples, fsIn, {
      noiseBand: [band.lo * 0.5, Math.min(22000, band.hi * 1.5)],
      delay: 0.1 + 0.07 * seed,
      ...channel,
      seed,
    });
    const got = messages(decodeSamples(rx, channel.fsOut ?? fsIn, { profiles: [p] }));
    if (got.length === 1 && text(got[0].bytes) === msg) ok++;
  }
  return ok;
}

test('SC-DFE: sembol hızı bandı doldurur, sondalar net hıza yansır', () => {
  const p = getProfile('dfe-cok-hizli');
  const info = dfeInfo(p);
  assert.equal(info.Rs, 4000); // (8000 − 2000) / 1,5
  assert.equal(info.m, 2);
  assert.ok(Math.abs(info.codedBitRate - (2 * 4000 * 96) / 104) < 1e-9);
});

test('SC-DFE: temiz kanal ve gürültü, üç profil', () => {
  for (const key of ['dfe-hizli', 'dfe-cok-hizli', 'dfe-yuksek-cok-hizli']) {
    assert.equal(success(key, {}, 2), 2, `${key} temiz`);
    assert.ok(success(key, { snr: 12 }, 3) >= 3, `${key} SNR 12 dB`);
  }
});

test('SC-DFE: 44,1 → 48 kHz, ±150 ppm saat farkı ve hareket (zaman ölçeği DPLL\'den izlenir)', () => {
  const room = { rt60: 0.4, drr: 12, snr: 20 };
  assert.ok(success('dfe-cok-hizli', { ...room, fsIn: 44100, fsOut: 48000, ppm: 150 }) >= 3, '+150 ppm');
  assert.ok(success('dfe-cok-hizli', { ...room, fsIn: 44100, fsOut: 48000, ppm: -150 }) >= 3, '−150 ppm');
  assert.ok(success('dfe-hizli', { ...room, motion: { speed: -0.1 } }) >= 3, 'yaklaşma 10 cm/sn');
  assert.ok(success('dfe-hizli', { ...room, motion: { amp: 0.01, freq: 0.5 } }) >= 3, 'elde titreme ±1 cm');
});

test('SC-DFE: yakın mesafe oda yankısı (50 cm, DRR +6 dB)', () => {
  const near = { rt60: 0.5, drr: 6, snr: 20 };
  assert.ok(success('dfe-hizli', near) >= 3, 'Hızlı');
  assert.ok(success('dfe-cok-hizli', near) >= 3, 'Çok hızlı');
});

/**
 * Eşitleyicinin kendisi: ayrık yansımalı (ana yoldan 0,75 ve 2 ms sonra, −2 ve −4 dB) yankısız
 * bir kanal. Yansımalar sembollerden (0,25 ms) çok uzun olduğundan eşitlemesiz alıcıda ISI
 * sinyal kadar güçlüdür; FB bunları temizler, eşitleyici çıkışındaki hata gücü küçük kalmalı.
 */
test('SC-DFE: eşitleyici ayrık yansımaların ISI\'sini temizler', () => {
  const p = getProfile('dfe-cok-hizli');
  const fs = 48000;
  const msg = bytes('eşitleyici deneme '.repeat(20));
  const { samples } = encodeMessage(msg, p.key, fs);
  const rx = new Float32Array(samples.length + fs * 0.01);
  for (const [delay, gainDb] of [
    [0, 0],
    [0.00075, -2],
    [0.002, -4],
  ]) {
    const d = Math.round(delay * fs);
    const g = 10 ** (gainDb / 20);
    for (let i = 0; i < samples.length; i++) rx[i + d] += g * samples[i];
  }
  const store = new SampleStore(rx.length);
  store.push(rx);
  const start = PRE_SILENCE * fs + (p.chirp.dur + p.gapDur) * fs;
  const demod = new DfeDemod(p, fs, start);
  const packet = buildPacket(msg, p);
  const total = 128 + Math.ceil(packet.header.length / 2) + Math.ceil(packet.payload.length / 2);
  let data = 0;
  for (let j = 0; j < total; j++) {
    const r = demod.read(store, j);
    assert.ok(r, `sembol ${j} okunamadı`);
    if (r.soft) data++;
  }
  assert.ok(data > 500);
  // Yansımaların toplam gücü doğrudan yolun ~1 katı: eşitlemesiz hata gücü ~1 olurdu.
  assert.ok(demod.mse < 0.05, `eşitleyici çıkışında hata gücü ${demod.mse.toFixed(3)}`);
  const got = messages(decodeSamples(rx, fs, { profiles: [p] }));
  assert.equal(got.length, 1);
  assert.equal(text(got[0].bytes), text(msg));
});
