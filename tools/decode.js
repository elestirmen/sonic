// Bir WAV kaydındaki Sonik paketlerini çözer; parçalı içerikleri (görsel/dosya) kurup kaydeder.
//   node tools/decode.js kayit.wav [--parola gizli] [--cikti klasör]

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeWav } from '../public/src/audio/wav.js';
import { Receiver } from '../public/src/receiver.js';
import { KIND_CHUNK } from '../public/src/codec/framing.js';
import { ObjectAssembler, TEXT_MIME, unpackBody } from '../public/src/transfer.js';
import { decryptBytes } from '../public/src/crypto.js';
import { parseArgs } from './args.js';

const { positional, flags } = parseArgs(process.argv.slice(2));
if (!positional[0]) {
  console.error('Kullanım: node tools/decode.js kayit.wav [--parola …] [--cikti klasör]');
  process.exit(1);
}
const { samples, sampleRate } = decodeWav(readFileSync(positional[0]));
const events = [];
const rx = new Receiver(sampleRate, { onEvent: (e) => events.push(e) });
for (let i = 0; i < samples.length; i += 4096) rx.push(samples.subarray(i, i + 4096));
rx.flush();

/** Şifreliyse parolayla açar; açamazsa null. */
async function open(bytes, encrypted) {
  if (!encrypted) return bytes;
  if (!flags.parola) return null;
  try {
    return await decryptBytes(bytes, flags.parola);
  } catch {
    return null;
  }
}

const assembler = new ObjectAssembler();
let found = 0;
for (const e of events) {
  if (e.type === 'fail') console.log(`✗ ${e.profile}: paket bozuk (${e.reason})`);
  if (e.type !== 'message') continue;
  const s = e.stats;
  const meta = `${e.profile} · SNR ${Math.round(s.snrDb)} dB · ${s.corrected} bayt düzeltildi · ρ ${s.rho.toFixed(2)}`;
  if (e.kind === KIND_CHUNK) {
    const r = assembler.add(e.bytes, { encrypted: e.encrypted });
    if (!r) continue;
    if (!r.fresh) {
      if (!r.done) console.log(`· parça ${r.have}/${r.need} (${meta})`);
      continue;
    }
    found++;
    if (r.error) {
      console.log(`✗ içerik kurulamadı: ${r.error}`);
      continue;
    }
    const body = await open(r.content, e.encrypted);
    if (!body) {
      console.log(`✓ (şifreli içerik, ${r.content.length} bayt; ${flags.parola ? 'parola uyuşmuyor' : '--parola ile aç'})`);
      continue;
    }
    const obj = unpackBody(body);
    if (!obj.name && obj.mime === TEXT_MIME) {
      console.log(`✓ ${new TextDecoder().decode(obj.data)}\n  ${meta}`);
      continue;
    }
    const name = obj.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '') || 'sonik-dosya';
    const path = join(flags.cikti ?? '.', name);
    writeFileSync(path, obj.data);
    console.log(`✓ dosya: ${path} (${obj.mime || 'tür yok'}, ${obj.data.length} bayt)\n  ${meta}`);
    continue;
  }
  found++;
  const plain = await open(e.bytes, e.encrypted);
  const text = plain
    ? new TextDecoder().decode(plain)
    : `(şifreli, ${e.bytes.length} bayt; ${flags.parola ? 'parola uyuşmuyor' : '--parola ile aç'})`;
  console.log(`✓ ${text}\n  ${meta}`);
}
for (const p of assembler.pending()) console.log(`… eksik içerik: ${p.have}/${p.need} parça`);
if (!found) console.log('Mesaj bulunamadı.');
