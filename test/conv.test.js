import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONV7,
  CONV9,
  bitsToBytes,
  byteReliability,
  bytesToBits,
  codedLength,
  convEncode,
  deinterleave,
  interleave,
  viterbiDecode,
} from '../public/src/codec/conv.js';
import { gaussian, rng } from '../public/src/dsp/channel.js';

const rand = rng(11);
const randomBits = (n) => Uint8Array.from({ length: n }, () => (rand() < 0.5 ? 1 : 0));

/** BPSK + gauss gürültü → LLR (pozitif: 0). */
function channel(code, ebn0) {
  const sigma = Math.sqrt(1 / (2 * 0.5 * 10 ** (ebn0 / 10))); // oran 1/2: Es = Eb/2
  return Float32Array.from(code, (b) => {
    const y = (b ? -1 : 1) + sigma * gaussian(rand);
    return (2 * y) / (sigma * sigma);
  });
}

test('evrişimli kod: gürültüsüz gidiş-dönüş, kodlu uzunluk', () => {
  const bits = randomBits(333);
  const code = convEncode(bits);
  assert.equal(code.length, codedLength(bits.length));
  const llr = Float32Array.from(code, (b) => (b ? -4 : 4));
  assert.deepEqual(viterbiDecode(llr, bits.length), bits);
});

test('Viterbi: 4 dB Eb/N0 kodlu hata oranı kodsuzun çok altında (≈ 5 dB kazanç)', () => {
  let err = 0;
  let unc = 0;
  const n = 20000;
  for (let i = 0; i < 10; i++) {
    const bits = randomBits(n / 10);
    const dec = viterbiDecode(channel(convEncode(bits), 4), bits.length);
    for (let k = 0; k < bits.length; k++) if (dec[k] !== bits[k]) err++;
    const sigma = Math.sqrt(1 / (2 * 10 ** 0.4));
    for (let k = 0; k < bits.length; k++) if ((((bits[k] ? -1 : 1) + sigma * gaussian(rand)) < 0 ? 1 : 0) !== bits[k]) unc++;
  }
  assert.ok(err / n < 1e-3, `kodlu BER ${err / n}`);
  assert.ok(unc / n > 5e-3, `kodsuz BER ${unc / n}`);
});

test('serpiştirme gidiş-dönüş ve ardışık bitlerin farklı sembollere düşmesi', () => {
  const bits = randomBits(1237);
  const il = interleave(bits, 9);
  const back = deinterleave(Float32Array.from(il), 9, bits.length);
  assert.deepEqual(Uint8Array.from(back), bits);
  // kodlu dizide ardışık iki bit, farklı 9 bitlik sembollerde
  const pos = (i) => {
    const cols = Math.ceil(bits.length / 9);
    return (i % cols) * 9 + Math.floor(i / cols);
  };
  assert.notEqual(Math.floor(pos(100) / 9), Math.floor(pos(101) / 9));
});

test('bayt güveni: kanalın bozduğu bölge düşük güven alır', () => {
  const bytes = Uint8Array.from({ length: 40 }, (_, i) => i * 7);
  const bits = bytesToBits(bytes);
  assert.deepEqual(bitsToBytes(bits), bytes);
  const code = convEncode(bits);
  const llr = Float32Array.from(code, (b) => (b ? -6 : 6));
  for (let i = 200; i < 230; i++) llr[i] = -llr[i] * 0.5; // bayt ~12–14 civarı bozuk
  const dec = viterbiDecode(llr, bits.length);
  const conf = byteReliability(dec, llr);
  const worst = conf.indexOf(Math.min(...conf));
  assert.ok(worst >= 11 && worst <= 15, `en düşük güven bayt ${worst}`);
  assert.ok(conf[0] > conf[worst] + 5);
});

test('K = 9 (JANUS): gidiş-dönüş ve 3 dB Eb/N0 hata oranı K = 7\'ninkinden düşük', () => {
  const bits = randomBits(500);
  assert.deepEqual(CONV9.viterbi(Float32Array.from(CONV9.encode(bits), (b) => (b ? -4 : 4)), bits.length), bits);
  let e7 = 0;
  let e9 = 0;
  for (let i = 0; i < 10; i++) {
    const b = randomBits(2000);
    const d7 = CONV7.viterbi(channel(CONV7.encode(b), 3), b.length);
    const d9 = CONV9.decode(channel(CONV9.encode(b), 3), b.length).bits;
    for (let k = 0; k < b.length; k++) {
      if (d7[k] !== b[k]) e7++;
      if (d9[k] !== b[k]) e9++;
    }
  }
  assert.ok(e9 < e7, `K9 ${e9} hata, K7 ${e7} hata`);
});
