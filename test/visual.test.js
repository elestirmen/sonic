import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VisualAssembler, VisualEncoder, MAX_VISUAL_CONTENT, frameIndices, parseVisualFrame } from '../public/src/visual/protocol.js';
import { encodeQr } from '../public/src/visual/qr.js';
import jsQR from '../public/src/vendor/jsqr.js';
import { packBody, TEXT_MIME, unpackBody } from '../public/src/transfer.js';
import { encryptBytes, decryptBytes } from '../public/src/crypto.js';
import { crc32 } from '../public/src/codec/crc32.js';
import { rng } from '../public/src/dsp/channel.js';

const bytes = (s) => new TextEncoder().encode(s);
const data = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 137 + (i >> 5)) & 255);
const id = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);

test('Görsel aktarım: Türkçe metin tek QR ile korunur, tekrarlar ikinci sonuç oluşturmaz', () => {
  const body = packBody({ mime: TEXT_MIME, data: bytes('Ekrandan kameraya: çığ, ğüşiöç 🙂') });
  const e = new VisualEncoder(body, { id });
  const a = new VisualAssembler();
  const r = a.add(e.frame(0));
  assert.equal(r.done, true);
  assert.deepEqual(unpackBody(r.content).data, unpackBody(body).data);
  assert.equal(a.add(e.frame(0)).content, undefined);
});

test('Görsel aktarım: dosya parçaları farklı sırada ve tekrarlarla tamamlanır', () => {
  const body = packBody({ name: 'deneme.bin', mime: 'application/octet-stream', data: data(8000) });
  const e = new VisualEncoder(body, { id, blockBytes: 192 });
  const a = new VisualAssembler();
  let completed;
  for (let i = e.k - 1; i >= 0; i--) {
    const frame = e.frame(i);
    const r = a.add(frame);
    if (r.content) completed = r;
    assert.equal(a.add(frame).have, r.have);
  }
  assert.deepEqual(completed.content, body);
  assert.equal(unpackBody(completed.content).name, 'deneme.bin');
});

test('Görsel aktarım: başı kaçan yayında %50 kare kaybı kurtarma kareleriyle tamamlanır', () => {
  for (const blockBytes of [192, 384, 512]) {
    const original = data(80000);
    const e = new VisualEncoder(original, { id, blockBytes });
    const a = new VisualAssembler();
    const random = rng(17);
    let completed;
    // Sistematik turun tamamı kaçtı; yalnız kurtarma kareleri geliyor.
    for (let seed = e.k + 17; seed < e.k * 10; seed++) {
      if (random() < 0.5) continue;
      const r = a.add(e.frame(seed));
      if (r.content) { completed = r; break; }
    }
    assert.ok(completed, `parça boyu ${blockBytes}`);
    assert.deepEqual(completed.content, original);
  }
});

test('Görsel aktarım: yalnız kurtarma kareleri 4 MB içeriği de birleştirir', () => {
  const original = data(4 * 1024 * 1024);
  const e = new VisualEncoder(original, { id, blockBytes: 512 });
  const a = new VisualAssembler();
  let completed;
  for (let seed = e.k; seed < e.k * 4; seed++) {
    const r = a.add(e.frame(seed));
    if (r.content) { completed = r; break; }
  }
  assert.ok(completed);
  assert.deepEqual(completed.content, original);
});

test('Görsel aktarım: farklı yayınlar birleştirilmez; bozuk ve ilgisiz QR yok sayılır', () => {
  const one = new VisualEncoder(data(1000), { id });
  const two = new VisualEncoder(data(1000), { id: new Uint8Array(8).fill(9) });
  const a = new VisualAssembler();
  assert.equal(a.add(one.frame(0)).have, 1);
  assert.equal(a.add(two.frame(1)).ignored, true);
  const bad = one.frame(1);
  bad[35] ^= 1;
  assert.equal(a.add(bad), null);
  assert.equal(a.add(bytes('https://example.com')), null);
  assert.equal(a.add(one.frame(1).subarray(0, 25)), null);
  a.add(one.frame(1));
  assert.deepEqual(a.add(one.frame(2)).content, data(1000));
});

test('Görsel aktarım: başlık sınırları bellek ayrılmadan denetlenir', () => {
  const frame = new VisualEncoder(data(100), { id }).frame(0);
  new DataView(frame.buffer).setUint32(15, 0xffffffff);
  new DataView(frame.buffer).setUint32(frame.length - 4, crc32(frame.subarray(0, -4)));
  const a = new VisualAssembler();
  assert.equal(parseVisualFrame(frame), null);
  assert.equal(a.add(frame), null);
  assert.equal(a.active, null);
  assert.throws(() => new VisualEncoder(new Uint8Array(MAX_VISUAL_CONTENT + 1)), /çok büyük/);
});

test('Görsel aktarım: kare sağlaması geçse bile bozuk içerik son sağlamada reddedilir', () => {
  const e = new VisualEncoder(data(700), { id });
  const a = new VisualAssembler();
  const changed = e.frame(0);
  changed[40] ^= 0x55;
  new DataView(changed.buffer).setUint32(changed.length - 4, crc32(changed.subarray(0, -4)));
  a.add(changed);
  assert.throws(() => a.add(e.frame(1)), /sağlaması tutmadı/);
});

test('Görsel aktarım: birikmiş çözülemeyen denklemler ve görülen kareler sınırlıdır', () => {
  const e = new VisualEncoder(data(900), { id });
  const a = new VisualAssembler();
  for (let seed = e.k; seed < 2000; seed++) {
    if (frameIndices(seed, e.k).length > 1) a.add(e.frame(seed));
  }
  assert.ok(a.active.equations.size <= 2 * e.k);
  assert.ok(a.active.seen.size <= 256);
});

test('Görsel aktarım: şifreli dosya korunur ve yanlış parola reddedilir', async () => {
  const body = packBody({ name: 'özel.txt', mime: 'text/plain', data: bytes('gizli görsel aktarım') });
  const content = await encryptBytes(body, 'deneme parolası');
  const e = new VisualEncoder(content, { id, encrypted: true, blockBytes: 32 });
  const a = new VisualAssembler();
  let completed;
  for (let seed = 0; seed < e.k; seed++) completed = a.add(e.frame(seed));
  assert.equal(completed.encrypted, true);
  await assert.rejects(decryptBytes(completed.content, 'yanlış parola'));
  assert.deepEqual(await decryptBytes(completed.content, 'deneme parolası'), body);
});

function pixelsForQr(qr, { scale = 4, rotate = false, dark = 0, light = 255 } = {}) {
  const width = (qr.size + 8) * scale;
  const pixels = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const mx = Math.floor(x / scale) - 4, my = Math.floor(y / scale) - 4;
    const black = mx >= 0 && my >= 0 && mx < qr.size && my < qr.size && qr.modules[my * qr.size + mx];
    const i = (rotate ? x * width + width - 1 - y : y * width + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = black ? dark : light;
    pixels[i + 3] = 255;
  }
  return { width, pixels };
}

test('Standart QR: üç yoğunlukta üretilen gerçek pikseller bağımsız jsQR ile çözülür', () => {
  for (const blockBytes of [192, 384, 512]) {
    const e = new VisualEncoder(data(1500), { id, blockBytes });
    for (const seed of [0, e.k + 1]) {
      const frame = e.frame(seed);
      const qr = encodeQr(frame);
      const { width, pixels } = pixelsForQr(qr, { rotate: true, dark: 35, light: 225 });
      const found = jsQR(pixels, width, width, { inversionAttempts: 'dontInvert' });
      assert.ok(found, `${blockBytes} bayt, kare ${seed}`);
      assert.deepEqual(Uint8Array.from(found.binaryData), frame);
      assert.ok(parseVisualFrame(Uint8Array.from(found.binaryData)));
    }
  }
});

test('QR uçtan uca: dosya gerçek QR görüntülerinden, eksik karelerle yeniden kurulur', () => {
  const original = packBody({ name: 'qr-dosya.bin', data: data(2300) });
  const e = new VisualEncoder(original, { id, blockBytes: 384 });
  const a = new VisualAssembler();
  let completed;
  for (let seed = 2; seed < e.k * 8; seed++) {
    if (seed % 3 === 0) continue;
    const { pixels, width } = pixelsForQr(encodeQr(e.frame(seed)));
    const found = jsQR(pixels, width, width, { inversionAttempts: 'dontInvert' });
    assert.ok(found);
    const r = a.add(Uint8Array.from(found.binaryData));
    if (r.content) { completed = r; break; }
  }
  assert.deepEqual(completed?.content, original);
});
