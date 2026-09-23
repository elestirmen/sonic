// Mesajı WAV dosyasına çevirir.
//   node tools/encode.js "mesaj" [çıktı.wav] [--profil normal] [--hiz 48000] [--parola gizli]

import { writeFileSync } from 'node:fs';
import { encodeMessage } from '../public/src/modem.js';
import { encodeWav } from '../public/src/audio/wav.js';
import { PROFILES } from '../public/src/profiles.js';
import { encryptBytes } from '../public/src/crypto.js';
import { parseArgs } from './args.js';

const { positional, flags } = parseArgs(process.argv.slice(2));
const [text, out = 'sonik.wav'] = positional;
if (!text) {
  console.error(`Kullanım: node tools/encode.js "mesaj" [çıktı.wav] [--profil ${PROFILES.map((p) => p.key).join('|')}] [--hiz 48000] [--parola …]`);
  process.exit(1);
}
const profile = flags.profil ?? 'normal';
const rate = Number(flags.hiz ?? 48000);
let bytes = new TextEncoder().encode(text);
if (flags.parola) bytes = await encryptBytes(bytes, flags.parola);
const { samples, duration } = encodeMessage(bytes, profile, rate, { amplitude: 0.9, encrypted: !!flags.parola });
writeFileSync(out, encodeWav(samples, rate));
console.log(`${out}: ${bytes.length} bayt, ${profile} profili, ${duration.toFixed(2)} sn @ ${rate} Hz`);
