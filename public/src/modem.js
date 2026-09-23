// Verici tarafı: mesaj baytları → paket (başlık + veri nibble'ları) → ses dalga formu.

import { PRE_SILENCE, POST_SILENCE, getProfile, supportsProfile, symbolDuration } from './profiles.js';
import { chirpWaveform } from './dsp/chirp.js';
import { KIND_TEXT, bytesToNibbles, encodeHeader, encodePayload, makeFlags, payloadLayout } from './codec/framing.js';
import { mfskSymbolCount, renderMfsk } from './mod/mfsk.js';
import { ofdmSymbolCount, renderOfdm } from './mod/ofdm.js';

export { PROFILES, getProfile, supportsProfile } from './profiles.js';
export { Receiver } from './receiver.js';

/** Çok paketli akışta paketler arasındaki sessizlik (s). */
export const PACKET_GAP = 0.06;

/** Paketin başlık ve veri nibble'ları. */
export function buildPacket(message, profile, { encrypted = false, kind = KIND_TEXT } = {}) {
  if (message.length === 0) throw new RangeError('mesaj boş');
  if (message.length > profile.maxBytes) throw new RangeError(`paket en çok ${profile.maxBytes} bayt olabilir`);
  return {
    header: bytesToNibbles(encodeHeader(message.length, makeFlags(profile.id, { encrypted, kind }))),
    payload: bytesToNibbles(encodePayload(message, profile)),
  };
}

export function symbolCount(byteLength, profile) {
  const nibbles = payloadLayout(byteLength, profile).total * 2;
  return profile.mod === 'ofdm' ? ofdmSymbolCount(profile, nibbles) : mfskSymbolCount(profile, nibbles);
}

/** Tek paketin chirp başından son sembolün sonuna kadar süresi (s). */
export function burstDuration(byteLength, profile) {
  return profile.chirp.dur + profile.gapDur + symbolCount(byteLength, profile) * symbolDuration(profile);
}

/** Paket süresi (saniye), sessiz kenarlar dahil. */
export function estimateDuration(byteLength, profile) {
  return PRE_SILENCE + burstDuration(byteLength, profile) + POST_SILENCE;
}

/** Ardışık paketlerin toplam süresi (s): tek sessiz baş/son, aralarda PACKET_GAP. */
export function estimateStreamDuration(byteLengths, profile) {
  let t = PRE_SILENCE + POST_SILENCE + PACKET_GAP * Math.max(0, byteLengths.length - 1);
  for (const n of byteLengths) t += burstDuration(n, profile);
  return t;
}

/** Paketi out'a yazar: chirpStart örneğinde chirp, ardından boşluk ve semboller. */
function renderPacket(out, chirpStart, packet, profile, fs, amplitude) {
  out.set(chirpWaveform(profile.chirp, fs, amplitude), chirpStart);
  const start = chirpStart + (profile.chirp.dur + profile.gapDur) * fs;
  const render = profile.mod === 'ofdm' ? renderOfdm : renderMfsk;
  render(out, start, packet.header, packet.payload, profile, fs, amplitude);
}

export function synthesize(packet, profile, fs, amplitude = 0.8) {
  return synthesizeStream([packet], profile, fs, amplitude);
}

/** Paketleri tek bir ses akışında arka arkaya dizer. */
export function synthesizeStream(packets, profile, fs, amplitude = 0.8) {
  const durations = packets.map((pk) => {
    const nibbles = pk.payload.length;
    const n = profile.mod === 'ofdm' ? ofdmSymbolCount(profile, nibbles) : mfskSymbolCount(profile, nibbles);
    return profile.chirp.dur + profile.gapDur + n * symbolDuration(profile);
  });
  const total = PRE_SILENCE + POST_SILENCE + PACKET_GAP * (packets.length - 1) + durations.reduce((s, d) => s + d, 0);
  const out = new Float32Array(Math.round(total * fs));
  let t = PRE_SILENCE;
  packets.forEach((pk, i) => {
    renderPacket(out, Math.round(t * fs), pk, profile, fs, amplitude);
    t += durations[i] + PACKET_GAP;
  });
  return out;
}

function checkRate(profile, fs) {
  if (!supportsProfile(profile, fs)) {
    throw new RangeError(`${fs} Hz örnekleme hızı ${profile.name} profili için yetersiz`);
  }
}

/** Tek adımda: bayt dizisi → ses örnekleri. */
export function encodeMessage(message, profileKey, fs, { amplitude = 0.8, encrypted = false, kind = KIND_TEXT } = {}) {
  const profile = getProfile(profileKey);
  checkRate(profile, fs);
  const packet = buildPacket(message, profile, { encrypted, kind });
  const samples = synthesize(packet, profile, fs, amplitude);
  return { samples, duration: samples.length / fs, packets: 1 };
}

/** Birden çok paket (ör. bir görselin parçaları) → tek ses akışı. */
export function encodePackets(payloads, profileKey, fs, { amplitude = 0.8, encrypted = false, kind = KIND_TEXT } = {}) {
  const profile = getProfile(profileKey);
  checkRate(profile, fs);
  const packets = payloads.map((m) => buildPacket(m, profile, { encrypted, kind }));
  const samples = synthesizeStream(packets, profile, fs, amplitude);
  return { samples, duration: samples.length / fs, packets: packets.length };
}
