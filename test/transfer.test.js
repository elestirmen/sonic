import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ObjectAssembler,
  chunkPlan,
  makeChunks,
  maxContentBytes,
  packBody,
  parseChunk,
  peekBody,
  unpackBody,
} from '../public/src/transfer.js';
import { KIND_CHUNK } from '../public/src/codec/framing.js';
import { encodePackets } from '../public/src/modem.js';
import { getProfile } from '../public/src/profiles.js';
import { gaussian, rng, simulateChannel } from '../public/src/dsp/channel.js';
import { decodeSamples, messages } from './helpers.js';

const rand = rng(7);
const randomBytes = (n) => Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

test('gövde: ad, tür ve veri korunur; bozulma yakalanır', () => {
  const data = randomBytes(1000);
  const body = packBody({ name: 'kapadokya çığ ğüşiöç.webp', mime: 'image/webp', data });
  const out = unpackBody(body);
  assert.equal(out.name, 'kapadokya çığ ğüşiöç.webp');
  assert.equal(out.mime, 'image/webp');
  assert.deepEqual(out.data, data);
  body[200] ^= 1;
  assert.throws(() => unpackBody(body));
  // 255 baytı aşan ad UTF-8 karakter sınırında kısaltılır
  const long = unpackBody(packBody({ name: 'ş'.repeat(200), mime: '', data: new Uint8Array(3) }));
  assert.equal(long.name, 'ş'.repeat(127));
});

test('parçalar: herhangi K farklı parça nesneyi kurar', () => {
  for (const [len, size] of [
    [10, 64],
    [60, 64],
    [3000, 480],
    [20000, 960],
    [maxContentBytes(128), 128],
  ]) {
    const content = randomBytes(len);
    const packets = makeChunks(content, size, 0x1234);
    const { k, m } = chunkPlan(len, size);
    assert.equal(packets.length, k + m);
    for (let trial = 0; trial < 3; trial++) {
      const asm = new ObjectAssembler();
      const pick = shuffle(packets).slice(0, k);
      let res;
      for (const p of pick) res = asm.add(p);
      assert.equal(res.done, true, `len=${len}`);
      assert.equal(res.fresh, true);
      assert.deepEqual(res.content, content);
    }
  }
});

test('parçalar: eksikken tamamlanmaz, tekrarlar sayılmaz, bitenden sonra yeniden kurulmaz', () => {
  const content = randomBytes(2000);
  const packets = makeChunks(content, 200, 7);
  const { k } = parseChunk(packets[0]);
  const asm = new ObjectAssembler();
  let res;
  for (const p of packets.slice(0, k - 1)) res = asm.add(p);
  res = asm.add(packets[0]); // tekrar
  assert.equal(res.have, k - 1);
  assert.equal(res.done, false);
  assert.equal(asm.pending().length, 1);
  res = asm.add(packets[k + 1]); // bir eşlik parçası eksik veriyi tamamlar
  assert.equal(res.fresh, true);
  assert.deepEqual(res.content, content);
  res = asm.add(packets[k]);
  assert.equal(res.done, true);
  assert.equal(res.fresh, false);
  assert.equal(asm.pending().length, 0);
});

test('önizleme: baştan kesintisiz gelen parçalar dosyanın başını verir, boşlukta durur', () => {
  const data = randomBytes(1500);
  const packets = makeChunks(packBody({ name: 'foto.webp', mime: 'image/webp', data }), 100, 11);
  const asm = new ObjectAssembler();
  asm.add(packets[1]);
  assert.equal(asm.prefix(11), null); // ilk parça yokken hiçbir şey okunamaz
  asm.add(packets[0]);
  let head = peekBody(asm.prefix(11).bytes);
  assert.equal(head.name, 'foto.webp');
  assert.equal(head.mime, 'image/webp');
  assert.equal(head.size, data.length);
  assert.deepEqual(head.data, data.subarray(0, head.data.length));
  const before = head.data.length;
  asm.add(packets[3]); // 2 eksik: önizleme ilerlemez
  assert.equal(peekBody(asm.prefix(11).bytes).data.length, before);
  assert.deepEqual(asm.pending()[0], { id: 11, have: 3, need: 16, total: 20, head: 2 });
  asm.add(packets[2]);
  head = peekBody(asm.prefix(11).bytes);
  assert.equal(head.data.length, before + 200);
  assert.deepEqual(head.data, data.subarray(0, head.data.length));
  for (const p of packets.slice(4, 15)) asm.add(p);
  // son parça gelmeden verinin tamamı görünmez ve CRC ile dolgu veriye karışmaz
  head = peekBody(asm.prefix(11).bytes);
  assert.ok(head.data.length < data.length);
  assert.deepEqual(head.data, data.subarray(0, head.data.length));
  assert.equal(asm.add(packets[15]).fresh, true);
  assert.equal(asm.prefix(11), null);
});

test('önizleme: başlık gelmeden ya da tanınmayan gövdede null', () => {
  const body = packBody({ name: 'x'.repeat(200), mime: 'image/webp', data: randomBytes(300) });
  const packets = makeChunks(body, 64, 5);
  const asm = new ObjectAssembler();
  asm.add(packets[0]); // 200 baytlık ad ilk 64 bayta sığmaz
  assert.equal(peekBody(asm.prefix(5).bytes), null);
  const junk = new Uint8Array(64);
  junk[3] = 60;
  assert.equal(peekBody(junk), null);
});

test('parçalar: aynı numaralı farklı nesneler karışmaz', () => {
  const a = makeChunks(randomBytes(900), 100, 99);
  const b = makeChunks(randomBytes(900), 120, 99); // farklı parça boyu → yeni nesne
  const asm = new ObjectAssembler();
  asm.add(a[0]);
  asm.add(b[0]);
  const res = asm.add(a[1]);
  assert.equal(res.have, 1);
});

test('görsel boyutunda nesne Turbo ile sesten geçer; bir paket gürültüyle yok olsa da kurulur', () => {
  const profile = getProfile('turbo');
  const content = packBody({ name: 'foto.webp', mime: 'image/webp', data: randomBytes(4000) });
  const packets = makeChunks(content, profile.chunkBytes, 4242);
  const { samples } = encodePackets(packets, profile.key, 48000, { kind: KIND_CHUNK });
  const rx = simulateChannel(samples, 48000, { rt60: 0.4, drr: 12, snr: 20, noiseBand: [1000, 15000], seed: 5 });
  // ilk paketin ortasına 0,8 sn'lik güçlü gürültü patlaması
  const noise = rng(3);
  const at = Math.round(0.8 * 48000);
  for (let i = at; i < at + 0.8 * 48000; i++) rx[i] += 0.8 * gaussian(noise);
  const events = decodeSamples(rx, 48000);
  const chunks = messages(events).filter((e) => e.kind === KIND_CHUNK);
  assert.ok(chunks.length < packets.length, 'patlama bir paketi silmeliydi');
  const asm = new ObjectAssembler();
  const done = chunks.map((e) => asm.add(e.bytes, { encrypted: e.encrypted })).find((r) => r?.fresh);
  assert.ok(done, 'nesne tamamlanmadı');
  assert.equal(done.error, undefined);
  const body = unpackBody(done.content);
  assert.equal(body.name, 'foto.webp');
  assert.deepEqual(packBody(body), content);
});
