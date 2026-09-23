import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LDPC, LDPC_TABLES, bpDecode, ldpcErrors } from '../public/src/codec/ldpc.js';
import { COSTAS, GRAY, ft8Info, renderFt8 } from '../public/src/mod/ft8.js';
import { encodeMessage } from '../public/src/modem.js';
import { getProfile, netByteRate, profileBand } from '../public/src/profiles.js';
import { gaussian, rng, simulateChannel } from '../public/src/dsp/channel.js';
import { bytes, decodeSamples, messages, text } from './helpers.js';

const rand = rng(21);
const randomBits = (n) => Uint8Array.from({ length: n }, () => (rand() < 0.5 ? 1 : 0));

test('LDPC(174, 91): ft8_lib tabloları tutarlı, her kod sözcüğü 83 denetimin hepsini sağlar', () => {
  const { GENERATOR, NM, MN } = LDPC_TABLES;
  assert.equal(GENERATOR.length, 83);
  assert.equal(NM.length, 83);
  assert.equal(MN.length, 174);
  // Mn, Nm'nin tersidir (her bit tam 3 denetimde); toplam 522 kenar
  assert.equal(NM.reduce((s, r) => s + r.length, 0), 522);
  for (let n = 0; n < 174; n++) {
    assert.equal(MN[n].length, 3);
    for (const m of MN[n]) assert.ok(NM[m - 1].includes(n + 1), `bit ${n + 1}, denetim ${m}`);
  }
  for (let t = 0; t < 200; t++) {
    const info = randomBits(91);
    const cw = LDPC.encode(info);
    assert.equal(cw.length, 174);
    assert.deepEqual(cw.subarray(0, 91), info); // sistematik
    assert.equal(ldpcErrors(cw), 0);
  }
  // tek bit hatası en az bir denetimi bozar
  const cw = LDPC.encode(randomBits(91));
  for (let n = 0; n < 174; n++) {
    cw[n] ^= 1;
    assert.ok(ldpcErrors(cw) > 0);
    cw[n] ^= 1;
  }
});

test('LDPC: bloklara bölme, tamamlama, gürültüsüz gidiş-dönüş', () => {
  for (const k of [56, 91, 92, 400, 91 * 5]) {
    const bits = randomBits(k);
    const coded = LDPC.encode(bits);
    assert.equal(coded.length, LDPC.codedLength(k));
    const { bits: out, conf } = LDPC.decode(Float32Array.from(coded, (b) => (b ? -3 : 3)), k);
    assert.deepEqual(out, bits);
    assert.equal(conf.length, k >> 3);
    assert.ok(conf.every((c) => c > 20));
  }
});

test('LDPC inanç yayılımı: BPSK, Eb/N0 3,5 dB → blokların ≥ %97si; tutmayan blokta güven düşük', () => {
  const R = 91 / 174;
  const sigma = Math.sqrt(1 / (2 * R * 10 ** 0.35));
  let fail = 0;
  const n = 150;
  for (let t = 0; t < n; t++) {
    const info = randomBits(91);
    const llr = Float64Array.from(LDPC.encode(info), (b) => (2 * ((b ? -1 : 1) + sigma * gaussian(rand))) / sigma ** 2);
    const res = bpDecode(llr);
    if (res.errors || !info.every((v, i) => v === res.hard[i])) fail++;
  }
  assert.ok(fail / n <= 0.03, `FER ${fail / n}`);
  // çok gürültülü blok: çözülemez, bütün baytlar RS silintisine aday (güven < 3)
  const bits = randomBits(91);
  const noisy = Float32Array.from(LDPC.encode(bits), (b) => (b ? -1 : 1) * 0.3 + 1.5 * gaussian(rand));
  const { conf, blocks } = LDPC.decode(noisy, 91);
  assert.ok(blocks[0].errors > 0);
  assert.ok(conf.every((c) => c < 3));
});

test('FT8 çerçevesi ve dalga formu: 79 sembol, Costas, sabit zarf, tepe genlik sınırı', () => {
  const p = { ...getProfile('ft8-saglam'), subchannels: 1 };
  const info = ft8Info(p);
  assert.equal(info.df, 1 / info.T); // h = 1
  const fs = 48000;
  const header = LDPC.encode(randomBits(56));
  const payload = LDPC.encode(randomBits(91));
  const out = new Float32Array(Math.ceil(2 * 79 * info.T * fs) + 10);
  const end = renderFt8(out, 3.3, header, payload, p, fs, 0.5);
  assert.ok(Math.abs(end - 3.3 - 2 * 79 * info.T * fs) <= 1);
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak <= 0.5 + 1e-6 && peak > 0.49);
  // tek alt kanal: zarf sabit (rampalar dışında), GFSK sürekli fazlı
  const mid = out.subarray(Math.round(info.T * fs), Math.round(150 * info.T * fs));
  let rms = 0;
  for (const v of mid) rms += v * v;
  assert.ok(Math.abs(Math.sqrt(rms / mid.length) - 0.5 / Math.SQRT2) < 0.01);
  // ilk Costas bloğunun tonları: DFT tepesi beklenen tonda
  const N = Math.round(info.T * fs);
  for (let i = 0; i < 7; i++) {
    const seg = out.subarray(Math.ceil(3.3) + i * N, Math.ceil(3.3) + (i + 1) * N);
    let best = -1;
    let bestE = -1;
    for (let k = 0; k < 8; k++) {
      const w = (2 * Math.PI * (p.fBase + k * info.df)) / fs;
      let re = 0;
      let im = 0;
      for (let n = 0; n < seg.length; n++) {
        re += seg[n] * Math.cos(w * n);
        im -= seg[n] * Math.sin(w * n);
      }
      if (re * re + im * im > bestE) (bestE = re * re + im * im), (best = k);
    }
    assert.equal(best, COSTAS[i]);
  }
  assert.deepEqual([...GRAY].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('FT8 profilleri: bant, h = 1, hız ve Nyquist sınırı', () => {
  for (const key of ['ft8-saglam', 'ft8-normal', 'ft8-hizli', 'ft8-yuksek']) {
    const p = getProfile(key);
    const { T, df, lo, hi } = ft8Info(p);
    assert.ok(Math.abs(df * T - 1) < 1e-12);
    assert.ok(lo > 1000 && hi < 17500, key);
    assert.ok(profileBand(p).hi < 0.48 * 44100, key);
    assert.ok(netByteRate(p) > 2, key);
  }
});

/** n denemeden kaçı çözüldü (kelime mesajları, bench ile aynı gürültü bandı). */
function success(key, channel, n = 3, len = 1) {
  const p = getProfile(key);
  const band = profileBand(p);
  let ok = 0;
  for (let seed = 1; seed <= n; seed++) {
    const msg = `ft8 ${seed}: `.padEnd(10 * len, 'merhaba dünya ');
    const fsIn = channel.fsIn ?? 48000;
    const { samples } = encodeMessage(bytes(msg), key, fsIn);
    const rx = simulateChannel(samples, fsIn, {
      noiseBand: [band.lo * 0.5, Math.min(22000, band.hi * 1.5)],
      delay: 0.2,
      ...channel,
      seed: seed + 100,
    });
    const got = messages(decodeSamples(rx, channel.fsOut ?? fsIn, { profiles: [p] }));
    if (got.length === 1 && text(got[0].bytes) === msg) ok++;
  }
  return ok;
}

test('FT8: çok düşük SNR (−15 dB) ve yankılı oda', () => {
  assert.ok(success('ft8-saglam', { snr: -15 }) >= 2, 'Sağlam −15 dB');
  assert.ok(success('ft8-normal', { snr: -15 }) >= 2, 'Normal −15 dB');
  assert.ok(success('ft8-hizli', { rt60: 0.5, drr: 0, snr: 15 }) >= 2, 'Hızlı, oda');
  assert.ok(success('ft8-normal', { rt60: 0.6, drr: -5, snr: 15 }) >= 2, 'Normal, uzak');
});

test('FT8: 44,1 → 48 kHz ±150 ppm, yaklaşma ve sallama', () => {
  const room = { rt60: 0.5, drr: 0, snr: 10 };
  assert.ok(success('ft8-normal', { fsIn: 44100, fsOut: 48000, ppm: 150, ...room }, 2) >= 1, '+150 ppm');
  assert.ok(success('ft8-hizli', { fsIn: 44100, fsOut: 48000, ppm: -150, ...room }, 2) >= 1, '−150 ppm');
  assert.ok(success('ft8-saglam', { ...room, motion: { speed: -0.1 } }, 2) >= 1, 'yaklaşma');
  assert.ok(success('ft8-yuksek', { ...room, motion: { amp: 0.03, freq: 0.7 } }, 2) >= 1, 'sallama, yüksek bant');
});
