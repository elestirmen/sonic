// Verici tarafı: mesaj baytları → paket sembolleri → ses dalga formu.

import { PRE_SILENCE, POST_SILENCE, getProfile, supportsProfile, toneFrequency } from './profiles.js';
import { chirpWaveform } from './dsp/chirp.js';
import {
  HEADER_BYTES,
  MAX_MESSAGE_BYTES,
  bytesToNibbles,
  encodeHeader,
  encodePayload,
  makeFlags,
  payloadLayout,
} from './codec/framing.js';

export { PROFILES, getProfile, supportsProfile } from './profiles.js';
export { Receiver } from './receiver.js';
export { MAX_MESSAGE_BYTES } from './codec/framing.js';

/** Paketi sembollere böler: her sembol, kanal başına bir 4-bitlik değer taşır. */
export function buildPacket(message, profile, { encrypted = false } = {}) {
  if (message.length === 0) throw new RangeError('mesaj boş');
  if (message.length > MAX_MESSAGE_BYTES) throw new RangeError(`mesaj en çok ${MAX_MESSAGE_BYTES} bayt olabilir`);
  const ch = profile.channels;
  const headerNibbles = bytesToNibbles(encodeHeader(message.length, makeFlags(profile.id, encrypted)));
  const payloadNibbles = bytesToNibbles(encodePayload(message, profile));
  const symbols = [];
  for (let i = 0; i < headerNibbles.length; i += ch) symbols.push(Array.from(headerNibbles.subarray(i, i + ch)));
  for (let i = 0; i < payloadNibbles.length; i += ch) {
    const sym = [];
    for (let c = 0; c < ch; c++) sym.push(payloadNibbles[i + c] ?? 0);
    symbols.push(sym);
  }
  return { symbols, headerSymbols: headerNibbles.length / ch };
}

export function symbolCount(byteLength, profile) {
  const ch = profile.channels;
  return (HEADER_BYTES * 2) / ch + Math.ceil((payloadLayout(byteLength, profile).total * 2) / ch);
}

/** Paket süresi (saniye), sessiz kenarlar dahil. */
export function estimateDuration(byteLength, profile) {
  return (
    PRE_SILENCE +
    profile.chirp.dur +
    profile.gapDur +
    symbolCount(byteLength, profile) * profile.symbolDur +
    POST_SILENCE
  );
}

export function synthesize(packet, profile, fs, amplitude = 0.8) {
  const chirpStart = Math.round(PRE_SILENCE * fs);
  const dataOffset = profile.chirp.dur + profile.gapDur;
  const nSym = packet.symbols.length;
  const out = new Float32Array(Math.round((PRE_SILENCE + dataOffset + nSym * profile.symbolDur + POST_SILENCE) * fs));
  out.set(chirpWaveform(profile.chirp, fs, amplitude), chirpStart);

  const a = amplitude / profile.channels;
  const rampN = Math.max(1, Math.round(profile.rampDur * fs));
  for (let j = 0; j < nSym; j++) {
    const s0 = chirpStart + Math.round((dataOffset + j * profile.symbolDur) * fs);
    const s1 = chirpStart + Math.round((dataOffset + (j + 1) * profile.symbolDur) * fs);
    const len = s1 - s0;
    const env = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      // yükseltilmiş kosinüs kenarlar: tık sesi ve spektral saçılma olmasın
      if (i < rampN) env[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / rampN);
      else if (i >= len - rampN) env[i] = 0.5 - 0.5 * Math.cos((Math.PI * (len - 1 - i)) / rampN);
      else env[i] = 1;
    }
    const set = j % profile.sets;
    for (let c = 0; c < profile.channels; c++) {
      const w = (2 * Math.PI * toneFrequency(profile, c, set, packet.symbols[j][c])) / fs;
      const phase = (c * Math.PI) / 2;
      for (let i = 0; i < len; i++) out[s0 + i] += a * env[i] * Math.sin(w * i + phase);
    }
  }
  return out;
}

/** Tek adımda: bayt dizisi → ses örnekleri. */
export function encodeMessage(message, profileKey, fs, { amplitude = 0.8, encrypted = false } = {}) {
  const profile = getProfile(profileKey);
  if (!supportsProfile(profile, fs)) {
    throw new RangeError(`${fs} Hz örnekleme hızı ${profile.name} profili için yetersiz`);
  }
  const packet = buildPacket(message, profile, { encrypted });
  const samples = synthesize(packet, profile, fs, amplitude);
  return { samples, duration: samples.length / fs, symbols: packet.symbols.length };
}
