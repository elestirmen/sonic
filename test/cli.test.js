import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { encodePackets } from '../public/src/modem.js';
import { encodeWav } from '../public/src/audio/wav.js';
import { KIND_CHUNK } from '../public/src/codec/framing.js';
import { makeChunks, packBody } from '../public/src/transfer.js';

const received = new TextEncoder().encode('Alınan dosya içeriği');
const body = packBody({ name: 'dosya.txt', mime: 'text/plain', data: received });
const { samples } = encodePackets(makeChunks(body, 64, 1234), 'hizli', 48000, { kind: KIND_CHUNK });
const recording = encodeWav(samples, 48000);
const decoder = fileURLToPath(new URL('../tools/decode.js', import.meta.url));

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sonik-cli-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wav = join(dir, 'kayit.wav');
  writeFileSync(wav, recording);
  return {
    dir,
    path: join(dir, 'dosya.txt'),
    decode() {
      const res = spawnSync(process.execPath, [decoder, wav, '--cikti', dir], { cwd: dir, encoding: 'utf8' });
      assert.ifError(res.error);
      return res;
    },
  };
}

test('CLI: yeni dosya sesten çözülüp kaydedilir', (t) => {
  const f = fixture(t);
  const res = f.decode();
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(readFileSync(f.path), Buffer.from(received));
});

test('CLI: aynı adlı mevcut dosyanın içeriği korunur', (t) => {
  const f = fixture(t);
  writeFileSync(f.path, 'Özgün dosya');
  const res = f.decode();
  assert.equal(res.status, 1);
  assert.match(res.stderr, /mevcut dosyaya dokunulmadı/);
  assert.equal(readFileSync(f.path, 'utf8'), 'Özgün dosya');
});

test('CLI: mevcut sembolik bağın hedefinin üzerine yazılmaz', (t) => {
  const f = fixture(t);
  const target = join(f.dir, 'hedef.txt');
  writeFileSync(target, 'Korunan hedef');
  symlinkSync(target, f.path);
  assert.equal(f.decode().status, 1);
  assert.equal(readFileSync(target, 'utf8'), 'Korunan hedef');
});
