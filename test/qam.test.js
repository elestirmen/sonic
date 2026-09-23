import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMessage } from '../public/src/modem.js';
import { getProfile, netByteRate, profileBand } from '../public/src/profiles.js';
import { simulateChannel } from '../public/src/dsp/channel.js';
import { PN127, interleaverTable, qamInfo } from '../public/src/mod/qam.js';
import { decodeSamples, messages } from './helpers.js';

test('OFDM-QAM: 802.11a karıştırıcı dizisi (x^7 + x^4 + 1, 1111111)', () => {
  // Standarttaki 127 bitlik dizinin başı: 00001110 11110010 11001001; tam dönem 127
  assert.equal(PN127.slice(0, 24).join(''), '000011101111001011001001');
  assert.equal(PN127.reduce((s, b) => s + b, 0), 64); // m-dizisi: 64 bir, 63 sıfır
});

test('OFDM-QAM: serpiştirici 16 | N iken 802.11a formülüne eşit, diğer N için bir permütasyon', () => {
  for (const m of [2, 4, 6]) {
    const N = 48 * m; // 802.11a: 48 veri taşıyıcısı
    const s = Math.max(m / 2, 1);
    const perm = interleaverTable(N, m);
    for (let k = 0; k < N; k++) {
      const i = (N / 16) * (k % 16) + Math.floor(k / 16);
      const j = s * Math.floor(i / s) + ((i + N - Math.floor((16 * i) / N)) % s);
      assert.equal(perm[k], j, `N=${N} k=${k}`);
    }
  }
  for (const [N, m] of [[132, 2], [152, 2], [304, 4], [102, 2], [456, 6]]) {
    const perm = interleaverTable(N, m);
    assert.equal(new Set(perm).size, N, `N=${N}`);
    // ardışık kodlu bitler aynı taşıyıcıya düşmez
    for (let k = 0; k + 1 < N; k++) assert.notEqual(Math.floor(perm[k] / m), Math.floor(perm[k + 1] / m));
  }
});

test('OFDM-QAM: profil düzeni ve net hızlar', () => {
  for (const p of ['qam-turbo', 'qam-cok-hizli', 'qam-hizli', 'qam-yuksek-cok-hizli'].map(getProfile)) {
    const info = qamInfo(p);
    assert.equal(info.Kb - info.D, 4, p.key); // blok başına 4 pilot
    assert.ok(profileBand(p).hi < 0.48 * 44100, p.key);
  }
  assert.ok(netByteRate(getProfile('qam-turbo')) > 3 * netByteRate(getProfile('turbo')));
  assert.ok(netByteRate(getProfile('qam-hizli')) > netByteRate(getProfile('cok-hizli')));
});

/** n denemeden kaçı doğru çözüldü (her denemede farklı veri ve gürültü). */
function success(key, channel, { n = 4, bytes = 300 } = {}) {
  const p = getProfile(key);
  const fsIn = channel.fsIn ?? 48000;
  const fsOut = channel.fsOut ?? fsIn;
  const band = profileBand(p);
  let ok = 0;
  for (let seed = 1; seed <= n; seed++) {
    const msg = Uint8Array.from({ length: bytes }, (_, i) => (i * 131 + seed * 57 + 7) & 255);
    const { samples } = encodeMessage(msg, key, fsIn);
    const rx = simulateChannel(samples, fsIn, {
      noiseBand: [band.lo * 0.5, Math.min(22000, band.hi * 1.5)],
      delay: 0.1 + 0.07 * seed,
      ...channel,
      seed,
    });
    const got = messages(decodeSamples(rx, fsOut, { profiles: [p] }));
    if (got.length === 1 && got[0].bytes.length === bytes && got[0].bytes.every((v, i) => v === msg[i])) ok++;
  }
  return ok;
}

test('OFDM-QAM Turbo (16-QAM): yan yana ve SNR 10 dB', () => {
  assert.ok(success('qam-turbo', { rt60: 0.4, drr: 15, snr: 20 }, { bytes: 600 }) >= 3, 'yan yana');
  assert.ok(success('qam-turbo', { snr: 10 }) >= 3, 'SNR 10 dB');
});

test('OFDM-QAM Çok hızlı (QPSK): 50 cm, SNR 6 dB, sallama', () => {
  assert.ok(success('qam-cok-hizli', { rt60: 0.5, drr: 6, snr: 20 }) >= 3, '50 cm');
  assert.ok(success('qam-cok-hizli', { snr: 6 }) >= 3, 'SNR 6 dB'); // 5 dB sınırda (~%90)
  const shake = { rt60: 0.4, drr: 10, snr: 20, motion: { amp: 0.03, freq: 0.7 } };
  assert.ok(success('qam-cok-hizli', shake) >= 3, 'sallama');
});

test('OFDM-QAM Hızlı (QPSK, 3 blok): yankılı oda, SNR 0 dB, konuşma girişimi', () => {
  assert.ok(success('qam-hizli', { rt60: 0.5, drr: 0, snr: 15 }, { bytes: 120 }) >= 3, 'oda');
  assert.ok(success('qam-hizli', { snr: 0 }, { bytes: 120 }) >= 3, 'SNR 0 dB');
  assert.ok(success('qam-hizli', { babble: 0, rt60: 0.3, drr: 5 }, { bytes: 120 }) >= 3, 'konuşma');
});

test('OFDM-QAM: 44.1 kHz verici → 48 kHz alıcı, ±150 ppm, en uzun paket; yaklaşma', () => {
  const room = { fsIn: 44100, fsOut: 48000, rt60: 0.3, drr: 15, snr: 25 };
  const cases = [['qam-turbo', 150], ['qam-cok-hizli', -150], ['qam-hizli', 120], ['qam-yuksek-cok-hizli', -120]];
  for (const [key, ppm] of cases) {
    assert.equal(success(key, { ...room, ppm }, { n: 1, bytes: 1024 }), 1, key);
  }
  assert.ok(success('qam-turbo', { rt60: 0.3, drr: 15, snr: 25, motion: { speed: -0.1 } }) >= 3, 'yaklaşma 10 cm/sn');
  const hold = { rt60: 0.4, drr: 10, snr: 20, motion: { amp: 0.01, freq: 0.5 } };
  assert.ok(success('qam-yuksek-cok-hizli', hold) >= 3, 'titreme, yüksek bant');
});

test('OFDM-QAM: yankı sınırı dürüst — Turbo 50 cm\'de, Çok hızlı DRR 0 dB\'de çözemez', () => {
  // Bu testler yöntemin bilinen sınırını belgeler; biri geçerse parametreleri yeniden değerlendir.
  assert.ok(success('qam-turbo', { rt60: 0.5, drr: 6, snr: 20 }, { n: 2 }) <= 1, 'Turbo 50 cm');
  assert.ok(success('qam-cok-hizli', { rt60: 0.5, drr: 0, snr: 15 }, { n: 2 }) <= 1, 'Çok hızlı oda');
});
