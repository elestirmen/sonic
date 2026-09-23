import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMessage } from '../public/src/modem.js';
import { getProfile, profileBand } from '../public/src/profiles.js';
import { gaussian, rng, simulateChannel } from '../public/src/dsp/channel.js';
import { SampleStore } from '../public/src/dsp/store.js';
import { DsssDemod, dsssInfo, interleaveOrder, renderDsss, spreadingCode } from '../public/src/mod/dsss.js';
import { bytes, decodeSamples, messages, text } from './helpers.js';

test('DSSS: m-dizileri, PRBS-15 ve Barker-11', () => {
  for (const [name, n] of [
    ['m31', 31],
    ['m63', 63],
    ['m127', 127],
  ]) {
    const c = spreadingCode(name);
    assert.equal(c.length, n);
    assert.equal(c.reduce((s, v) => s + v, 0), -1, `${name} dengesi`); // bir fazla −1 (1 bitleri)
    for (let k = 1; k < n; k++) {
      let r = 0;
      for (let i = 0; i < n; i++) r += c[i] * c[(i + k) % n];
      assert.equal(r, -1, `${name} döngüsel ilinti, kayma ${k}`);
    }
  }
  // PRBS-15: periyot 32767, denge ve birkaç kaymada döngüsel ilinti
  const long = spreadingCode('prbs15');
  assert.equal(long.length, 32767);
  assert.equal(long.reduce((s, v) => s + v, 0), -1);
  for (const k of [1, 31, 63, 1000, 16383]) {
    let r = 0;
    for (let i = 0; i < long.length; i++) r += long[i] * long[(i + k) % long.length];
    assert.equal(r, -1, `prbs15 döngüsel ilinti, kayma ${k}`);
  }
  const b = spreadingCode('barker11');
  for (let k = 1; k < 11; k++) {
    let r = 0;
    for (let i = 0; i + k < 11; i++) r += b[i] * b[i + k];
    assert.ok(Math.abs(r) <= 1, `Barker yan tepesi, kayma ${k}`);
  }
});

/** n denemeden kaçında mesaj doğru çözülür (her denemede farklı tohum ve metin). */
function success(key, channel, n = 4, body = 'Sonik DSSS') {
  const p = getProfile(key);
  const band = profileBand(p);
  const fsIn = channel.fsIn ?? 48000;
  let ok = 0;
  for (let seed = 1; seed <= n; seed++) {
    const msg = `${seed}: ${body}`;
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

test('DSSS: çok düşük SNR (−15 dB) ve çok uzak yankılı salon', () => {
  assert.ok(success('dsss-normal', { snr: -15 }) >= 3, 'Normal −15 dB');
  assert.ok(success('dsss-saglam', { snr: -15 }, 3) >= 2, 'Sağlam −15 dB');
  assert.ok(success('dsss-saglam', { rt60: 1.2, drr: -12, snr: 5 }, 3) >= 2, 'Sağlam çok uzak');
});

test('DSSS: 44,1 → 48 kHz, ±150 ppm saat farkı, hareket', () => {
  const far = { fsIn: 44100, fsOut: 48000, rt60: 0.6, drr: -5, snr: 10 };
  assert.ok(success('dsss-normal', { ...far, ppm: 150 }) >= 3, 'Normal +150 ppm');
  assert.ok(success('dsss-hizli', { ...far, ppm: -150, motion: { speed: -0.1 } }) >= 3, 'Hızlı −150 ppm, yaklaşma');
  const room = { rt60: 0.5, drr: 0, snr: 10 };
  assert.ok(success('dsss-normal', { ...room, motion: { amp: 0.03, freq: 0.7 } }) >= 3, 'Normal sallama');
  const shake = { amp: 0.03, freq: 0.7 };
  const ultra = { ...room, fsIn: 44100, fsOut: 48000, ppm: 120, motion: shake };
  assert.ok(success('dsss-ultra-hizli', ultra) >= 3, 'Ultrasonik sallama + 120 ppm');
});

test('DSSS: RAKE ayrık yansımaları kol olarak bulur; LLR ölçeği gerçekçi', () => {
  const p = getProfile('dsss-normal');
  const info = dsssInfo(p);
  const fs = 48000;
  const rand = rng(11);
  const header = Uint8Array.from({ length: 124 }, () => (rand() < 0.5 ? 1 : 0));
  const payload = Uint8Array.from({ length: 1500 }, () => (rand() < 0.5 ? 1 : 0));
  const count = info.ref + header.length + payload.length;
  const start = 0.1 * fs;
  const tx = new Float32Array(Math.ceil(start + count * info.T * fs + 0.1 * fs));
  renderDsss(tx, start, header, payload, p, fs, 0.8);
  // doğrudan yol + 1,3 ms ve 3,1 ms'de iki yansıma; tam çip katı olmayan gecikmeler
  const taps = [
    [0, 1],
    [1.3e-3, 0.7],
    [3.1e-3, -0.5],
  ];
  const rx = new Float32Array(tx.length);
  for (const [d, g] of taps) {
    const k = Math.round(d * fs);
    for (let i = 0; i + k < rx.length; i++) rx[i + k] += g * tx[i];
  }
  let e = 0;
  for (const v of rx) e += v * v;
  // tam bantta (0–24 kHz) SNR −17 dB: bit başı ~6 dB
  const sigma = Math.sqrt(e / (count * info.T * fs)) * Math.pow(10, 17 / 20);
  const nrand = rng(12);
  for (let i = 0; i < rx.length; i++) rx[i] += sigma * gaussian(nrand);
  const store = new SampleStore(rx.length);
  store.push(rx);
  const demod = new DsssDemod(p, fs, start);
  const seen = new Map();
  const stats = [];
  for (let j = 0; j < count; j++) {
    const res = demod.read(store, j);
    if (res.soft) {
      stats.push(res.soft[0]);
      for (const f of demod.fingers) seen.set(f - demod.l0, (seen.get(f - demod.l0) ?? 0) + 1);
    }
  }
  // kollar: yarım çip cinsinden gecikme (Rc = 4000 → 1,3 ms ≈ 10,4; 3,1 ms ≈ 24,8)
  const often = [...seen].filter(([, n]) => n > 0.5 * stats.length).map(([l]) => l);
  assert.ok(often.includes(0), `ana kol: ${often}`);
  assert.ok(often.some((l) => Math.abs(l - 10.4) <= 1), `1,3 ms kolu: ${often}`);
  assert.ok(often.some((l) => Math.abs(l - 24.8) <= 1), `3,1 ms kolu: ${often}`);
  // LLR'ler olabilirlik oranı gibi davranmalı: |LLR| ∈ [1, 3) olan bitlerin hata oranı, öngörülenin
  // (1 / (1 + e^|LLR|)) yarısıyla iki katı arasında
  const sent = [];
  for (const i of interleaveOrder(header.length)) sent.push(header[i]);
  for (const i of interleaveOrder(payload.length)) sent.push(payload[i]);
  let errors = 0;
  let predicted = 0;
  let total = 0;
  let wrong = 0;
  stats.forEach((l, i) => {
    const bad = (l < 0 ? 1 : 0) !== sent[i];
    wrong += bad;
    if (Math.abs(l) >= 1 && Math.abs(l) < 3) {
      total++;
      errors += bad;
      predicted += 1 / (1 + Math.exp(Math.abs(l)));
    }
  });
  assert.ok(wrong / stats.length < 0.05, `bit hata oranı ${wrong / stats.length}`);
  assert.ok(total > 50, `orta güvenli bit sayısı ${total}`);
  assert.ok(errors > predicted / 2 && errors < 2 * predicted, `hata ${errors}, öngörülen ${predicted.toFixed(1)}`);
});
