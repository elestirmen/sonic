// Mesajı ya da dosyayı WAV'a çevirir.
//   node tools/encode.js "mesaj" [çıktı.wav] [--profil normal] [--hiz 48000] [--parola gizli]
//   node tools/encode.js --dosya foto.webp [çıktı.wav] [--profil turbo] …
// Tek pakete sığmayan metin ve her dosya parçalanıp paketler arası hata düzeltmeyle gönderilir.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { encodeMessage, encodePackets, estimateStreamDuration } from '../public/src/modem.js';
import { encodeWav } from '../public/src/audio/wav.js';
import { PROFILES, getProfile } from '../public/src/profiles.js';
import { KIND_CHUNK } from '../public/src/codec/framing.js';
import { TEXT_MIME, makeChunks, maxContentBytes, packBody, planChunks } from '../public/src/transfer.js';
import { encryptBytes } from '../public/src/crypto.js';
import { parseArgs } from './args.js';

const MIME = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', txt: 'text/plain', pdf: 'application/pdf' };

const { positional, flags } = parseArgs(process.argv.slice(2));
const [first, second] = positional;
const text = flags.dosya ? null : first;
const out = (flags.dosya ? first : second) ?? 'sonik.wav';
if (!text && !flags.dosya) {
  console.error(
    `Kullanım: node tools/encode.js "mesaj" [çıktı.wav] [--profil ${PROFILES.map((p) => p.key).join('|')}] [--hiz 48000] [--parola …]\n` +
      '          node tools/encode.js --dosya yol [çıktı.wav] [--profil …] [--hiz …] [--parola …]',
  );
  process.exit(1);
}
const profile = getProfile(flags.profil ?? (flags.dosya ? 'turbo' : 'normal'));
const rate = Number(flags.hiz ?? 48000);
const opts = { amplitude: 0.9, encrypted: !!flags.parola };
const seal = (bytes) => (flags.parola ? encryptBytes(bytes, flags.parola) : bytes);

let res;
let what;
const bytes = text !== null ? new TextEncoder().encode(text) : null;
const single = bytes && (await seal(bytes));
if (single && single.length <= profile.maxBytes) {
  res = encodeMessage(single, profile.key, rate, opts);
  what = `${single.length} bayt`;
} else {
  const body = bytes
    ? packBody({ mime: TEXT_MIME, data: bytes })
    : packBody({ name: basename(flags.dosya), mime: MIME[flags.dosya.split('.').pop().toLowerCase()] ?? 'application/octet-stream', data: readFileSync(flags.dosya) });
  const content = await seal(body);
  if (content.length > maxContentBytes(profile.chunkBytes)) {
    console.error(`${content.length} bayt ${profile.name} profili için çok büyük (en çok ${maxContentBytes(profile.chunkBytes)} bayt).`);
    process.exit(1);
  }
  const plan = planChunks(content.length, profile.chunkBytes, (n, count) => estimateStreamDuration(new Array(count).fill(n), profile));
  const id = Math.floor(Math.random() * 65536);
  res = encodePackets(makeChunks(content, plan.chunkBytes, id), profile.key, rate, { ...opts, kind: KIND_CHUNK });
  what = `${content.length} bayt, ${plan.k + plan.m} paket (herhangi ${plan.k} tanesi yeter)`;
}
writeFileSync(out, encodeWav(res.samples, rate));
console.log(`${out}: ${what}, ${profile.name} profili, ${res.duration.toFixed(2)} sn @ ${rate} Hz`);
