import { Receiver } from '../public/src/receiver.js';
import { PROFILES } from '../public/src/profiles.js';

/** Sesi alıcıya (isteğe bağlı rastgele boyutlu parçalar hâlinde) verir, olayları döndürür. */
export function decodeSamples(samples, fs, { profiles = PROFILES, chunk = 2048, rand = null } = {}) {
  const events = [];
  const rx = new Receiver(fs, { profiles, onEvent: (e) => events.push(e) });
  for (let i = 0; i < samples.length; ) {
    const n = rand ? 1 + Math.floor(rand() * chunk) : chunk;
    rx.push(samples.subarray(i, i + n));
    i += n;
  }
  rx.flush();
  return events;
}

export const messages = (events) => events.filter((e) => e.type === 'message');
export const text = (bytes) => new TextDecoder().decode(bytes);
export const bytes = (s) => new TextEncoder().encode(s);

export function concat(...parts) {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
