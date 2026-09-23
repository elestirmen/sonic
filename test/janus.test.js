import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPacket, encodeMessage } from '../public/src/modem.js';
import { getProfile, symbolDuration } from '../public/src/profiles.js';
import { simulateChannel } from '../public/src/dsp/channel.js';
import {
  PAIRS,
  hopPair,
  janusDeinterleave,
  janusInterleave,
  janusSymbolCount,
  renderJanus,
} from '../public/src/mod/janus.js';
import { bytes, decodeSamples, messages, text } from './helpers.js';

test('JANUS: atlama dizisi her 13 çipte her çifti bir kez kullanır, ardışık çipler uzak çiftlerde', () => {
  for (let k = 0; k < 200; k++) {
    const window = new Set(Array.from({ length: PAIRS }, (_, m) => hopPair(k + m)));
    assert.equal(window.size, PAIRS);
    assert.ok(Math.abs(hopPair(k + 1) - hopPair(k)) >= 5, `çip ${k}`);
  }
});

test('JANUS: serpiştirme gidiş-dönüş; komşu kodlu bitler farklı çiftte ve uzak çiplerde', () => {
  for (const n of [128, 400, 624, 1000, 4576]) {
    const bits = Uint8Array.from({ length: n }, (_, i) => (i * 7 + (i >> 3)) & 1);
    const il = janusInterleave(bits);
    const back = janusDeinterleave(Float32Array.from(il, (b) => (b ? -1 : 1)), n);
    assert.deepEqual(Uint8Array.from(back, (l) => (l < 0 ? 1 : 0)), bits);
    // kodlu bit i'nin çip konumu
    const pos = new Int32Array(n);
    const mark = Float32Array.from({ length: n }, (_, j) => j);
    janusDeinterleave(mark, n).forEach((j, i) => (pos[i] = j));
    for (let i = 0; i + 1 < n; i++) {
      const d = Math.abs(pos[i + 1] - pos[i]);
      assert.ok(Math.min(d, n - d) >= 13, `n=${n}, bit ${i}`);
      assert.notEqual(hopPair(pos[i + 1]), hopPair(pos[i]), `n=${n}, bit ${i}`);
    }
  }
});

test('JANUS: dalga formu genliği aşmaz, uzunluğu sembol sayısı × çip süresi', () => {
  const p = getProfile('janus-normal');
  const { header, payload } = buildPacket(bytes('genlik'), p);
  for (const fs of [44100, 48000]) {
    const n = janusSymbolCount(p, header.length, payload.length);
    const out = new Float32Array(Math.ceil(n * symbolDuration(p) * fs) + 10);
    const end = renderJanus(out, 3.4, header, payload, p, fs, 0.8);
    assert.ok(Math.abs(end - 3.4 - n * symbolDuration(p) * fs) <= 1);
    assert.ok(out.every((v) => Math.abs(v) <= 0.8 + 1e-6));
  }
});

/** n denemeden kaçı doğru çözüldü (kısa mesajlarla). */
function success(key, channel, n = 3) {
  const p = getProfile(key);
  let ok = 0;
  for (let seed = 1; seed <= n; seed++) {
    const msg = `deneme ${seed}: JANUS`;
    const fsIn = channel.fsIn ?? 48000;
    const { samples } = encodeMessage(bytes(msg), key, fsIn);
    const rx = simulateChannel(samples, fsIn, { delay: 0.2, ...channel, seed });
    const got = messages(decodeSamples(rx, channel.fsOut ?? fsIn, { profiles: [p] }));
    if (got.length === 1 && text(got[0].bytes) === msg) ok++;
  }
  return ok;
}

const NOISE_STD = [850, 12500];

test('JANUS: kilise gibi salonda (RT60 2 s, DRR −15 dB) Sağlam ve Normal çözer, MFSK Normal çözemez', () => {
  const church = { rt60: 2.0, drr: -15, snr: 10, noiseBand: NOISE_STD };
  assert.ok(success('janus-saglam', church) >= 2, 'JANUS Sağlam');
  assert.ok(success('janus-normal', church, 2) === 2, 'JANUS Normal');
  assert.ok(success('normal', church) <= 1, 'MFSK Normal beklenenden iyi: test koşulu eskidi mi?');
});

test('JANUS: çok düşük SNR (−15 dB) ve çok uzak + gürültü (RT60 1.2 s, DRR −12 dB, SNR −5 dB)', () => {
  assert.ok(success('janus-saglam', { snr: -15, noiseBand: NOISE_STD }) >= 2, '−15 dB');
  assert.ok(success('janus-saglam', { rt60: 1.2, drr: -12, snr: -5, noiseBand: NOISE_STD }) >= 2, 'uzak + gürültü');
});

test('JANUS: 44,1 → 48 kHz ±150 ppm, sallama ve hızlı yaklaşma', () => {
  const far = { rt60: 1.2, drr: -12, snr: 5, noiseBand: NOISE_STD };
  assert.ok(success('janus-normal', { ...far, fsIn: 44100, fsOut: 48000, ppm: 150 }, 2) === 2, '+150 ppm');
  assert.ok(success('janus-normal', { ...far, fsIn: 44100, fsOut: 48000, ppm: -150 }, 1) === 1, '−150 ppm');
  const hall = { rt60: 1.0, drr: -8, snr: 15, noiseBand: NOISE_STD };
  assert.ok(success('janus-normal', { ...hall, motion: { amp: 0.03, freq: 0.7 } }, 1) === 1, 'sallama');
  assert.ok(success('janus-normal', { ...hall, motion: { speed: -0.3 } }, 2) === 2, 'yaklaşma 30 cm/sn');
  const ultra = { rt60: 0.6, drr: -5, snr: 10, noiseBand: [8700, 22000] };
  assert.ok(success('janus-ultra', { ...ultra, motion: { speed: -0.3 } }, 1) === 1, 'ultrasonik, Doppler 17 Hz');
});

test('JANUS: uzun paket (200 bayt, ~38 sn), 20 cm/sn yaklaşma: ~22 ms (2 çip) kayma izlenir', () => {
  const p = getProfile('janus-normal');
  const msg = new Uint8Array(200).map((_, i) => (i * 37 + 11) & 255);
  const { samples } = encodeMessage(msg, p.key, 48000);
  const rx = simulateChannel(samples, 48000, {
    motion: { speed: -0.2 },
    rt60: 0.6,
    drr: -5,
    snr: 15,
    noiseBand: NOISE_STD,
    delay: 0.2,
    seed: 1,
  });
  const got = messages(decodeSamples(rx, 48000, { profiles: [p] }));
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].bytes, msg);
});
