// Bir WAV kaydındaki Sonik paketlerini çözer.
//   node tools/decode.js kayit.wav [--parola gizli]

import { readFileSync } from 'node:fs';
import { decodeWav } from '../public/src/audio/wav.js';
import { Receiver } from '../public/src/receiver.js';
import { decryptBytes } from '../public/src/crypto.js';
import { parseArgs } from './args.js';

const { positional, flags } = parseArgs(process.argv.slice(2));
if (!positional[0]) {
  console.error('Kullanım: node tools/decode.js kayit.wav [--parola …]');
  process.exit(1);
}
const { samples, sampleRate } = decodeWav(readFileSync(positional[0]));
const events = [];
const rx = new Receiver(sampleRate, { onEvent: (e) => events.push(e) });
for (let i = 0; i < samples.length; i += 4096) rx.push(samples.subarray(i, i + 4096));
rx.flush();

let found = 0;
for (const e of events) {
  if (e.type === 'fail') console.log(`✗ ${e.profile}: paket bozuk (${e.reason})`);
  if (e.type !== 'message') continue;
  found++;
  const s = e.stats;
  const meta = `${e.profile} · SNR ${Math.round(s.snrDb)} dB · ${s.corrected} bayt düzeltildi · ρ ${s.rho.toFixed(2)}`;
  let text;
  if (!e.encrypted) text = new TextDecoder().decode(e.bytes);
  else if (!flags.parola) text = `(şifreli, ${e.bytes.length} bayt; --parola ile aç)`;
  else {
    try {
      text = new TextDecoder().decode(await decryptBytes(e.bytes, flags.parola));
    } catch {
      text = '(şifreli; parola uyuşmuyor)';
    }
  }
  console.log(`✓ ${text}\n  ${meta}`);
}
if (!found) console.log('Mesaj bulunamadı.');
