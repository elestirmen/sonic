import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from '../public/src/codec/crc32.js';
import { rsEncode, rsDecode } from '../public/src/codec/reedsolomon.js';
import {
  decodeHeader,
  decodePayload,
  encodeHeader,
  encodePayload,
  makeFlags,
  payloadLayout,
} from '../public/src/codec/framing.js';
import { getProfile } from '../public/src/profiles.js';
import { rng } from '../public/src/dsp/channel.js';

const rand = rng(42);
const randInt = (n) => Math.floor(rand() * n);
const randomBytes = (n) => Uint8Array.from({ length: n }, () => randInt(256));
function pickPositions(n, count, exclude = new Set()) {
  const out = new Set();
  while (out.size < count) {
    const p = randInt(n);
    if (!exclude.has(p)) out.add(p);
  }
  return [...out];
}

test('CRC-32 bilinen değer', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('Reed-Solomon: kapasite içindeki her hata/silinti birleşimi düzelir', () => {
  for (let iter = 0; iter < 3000; iter++) {
    const nsym = [2, 4, 8, 10, 16, 32, 64][randInt(7)];
    const k = 1 + randInt(255 - nsym);
    const data = randomBytes(k);
    const code = rsEncode(data, nsym);
    const erasures = randInt(nsym + 1);
    const errors = randInt(Math.floor((nsym - erasures) / 2) + 1);
    const erasePos = pickPositions(code.length, Math.min(erasures, code.length));
    const errPos = pickPositions(code.length, Math.min(errors, code.length - erasePos.length), new Set(erasePos));
    const bad = code.slice();
    for (const p of erasePos) bad[p] = randInt(256);
    for (const p of errPos) bad[p] ^= 1 + randInt(255);
    const res = rsDecode(bad, nsym, erasePos);
    assert.deepEqual(res.data, data, `k=${k} nsym=${nsym} e=${errPos.length} s=${erasePos.length}`);
  }
});

test('Reed-Solomon: temiz kod sözcüğü değişmeden döner', () => {
  const data = randomBytes(100);
  const res = rsDecode(rsEncode(data, 20), 20);
  assert.deepEqual(res.data, data);
  assert.equal(res.corrected, 0);
});

test('Reed-Solomon: kapasite aşılınca ya hata verir ya da farklı veri döner (CRC yakalar)', () => {
  let threw = 0;
  for (let iter = 0; iter < 500; iter++) {
    const data = randomBytes(40);
    const code = rsEncode(data, 8);
    const bad = code.slice();
    for (const p of pickPositions(code.length, 6)) bad[p] ^= 1 + randInt(255);
    try {
      const res = rsDecode(bad, 8);
      assert.notDeepEqual(res.data, data);
    } catch {
      threw++;
    }
  }
  assert.ok(threw > 400, `çoğu durumda hata bildirmeli (${threw}/500)`);
});

test('Başlık: kodla, 2 hatayı düzelt, yanlış profili ve sınır dışı uzunluğu reddet', () => {
  const hizli = getProfile('hizli');
  const hdr = encodeHeader(123, makeFlags(hizli.id, { encrypted: true, kind: 1 }));
  const bad = hdr.slice();
  bad[0] ^= 0x55;
  bad[5] ^= 0x0f;
  const res = decodeHeader(bad, null, hizli);
  assert.equal(res.length, 123);
  assert.equal(res.encrypted, true);
  assert.equal(res.kind, 1);
  assert.equal(decodeHeader(hdr, null, getProfile('saglam')), null);
  const turbo = getProfile('turbo');
  assert.equal(decodeHeader(encodeHeader(1000, makeFlags(turbo.id)), null, turbo).length, 1000);
  assert.equal(decodeHeader(encodeHeader(1000, makeFlags(hizli.id)), null, hizli), null); // MFSK en çok 255
});

test('Veri bölümü: tek ve çok bloklu, hatalı ve silintili', () => {
  for (const key of ['normal', 'saglam', 'hizli', 'ultrasonik', 'turbo']) {
    const profile = getProfile(key);
    for (const len of [1, 13, 100, 200, 255, ...(profile.maxBytes > 255 ? [700, 1024] : [])]) {
      const msg = randomBytes(len);
      const coded = encodePayload(msg, profile);
      const layout = payloadLayout(len, profile);
      assert.equal(coded.length, layout.total);
      // her bloğun kapasitesinin yarısı kadar hata, rastgele yerlere
      const bad = coded.slice();
      const minParity = Math.min(...layout.blocks.map((b) => b.p));
      const nErr = Math.floor((minParity / 2) * layout.blocks.length * 0.5);
      for (const p of pickPositions(bad.length, nErr)) bad[p] ^= 1 + randInt(255);
      const res = decodePayload(bad, new Float32Array(bad.length).fill(10), len, profile);
      assert.ok(res.ok, `${key} len=${len}`);
      assert.deepEqual(res.message, msg);
    }
  }
});

test('Veri bölümü: silinti bilgisi düzeltme gücünü ikiye katlar', () => {
  const profile = getProfile('normal');
  const msg = randomBytes(60);
  const coded = encodePayload(msg, profile);
  const { parity } = payloadLayout(60, profile); // 20 parite
  const bad = coded.slice();
  const conf = new Float32Array(bad.length).fill(12);
  const pos = pickPositions(bad.length, parity - 2); // yalnız hata olarak düzeltilemez
  for (const p of pos) {
    bad[p] ^= 1 + randInt(255);
    conf[p] = 0.5; // alıcı bu sembollerden emin değil
  }
  assert.equal(decodePayload(bad, new Float32Array(bad.length).fill(12), 60, profile).ok, false);
  const res = decodePayload(bad, conf, 60, profile);
  assert.ok(res.ok);
  assert.deepEqual(res.message, msg);
});
