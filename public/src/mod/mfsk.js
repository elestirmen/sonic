// MFSK: her sembolde kanal başına tek ton, her ton 4 bit (16 frekanstan biri).
// Ardışık semboller dönüşümlü ton kümeleri kullanır (bkz. profiles.js); oda yankısı
// önceki sembolü uzatsa da çözülen kümeye düşmez. Uzak mesafe ve yankılı oda için.

import { VALUES_PER_TONE, toneFrequency } from '../profiles.js';
import { HEADER_NIBBLES } from '../codec/framing.js';
import { goertzelCoeff, hann, tonePowers } from '../dsp/filters.js';

/** Başlık, kanal sayısının katına tamamlanır; veri bir sonraki sembolden başlar. */
export const mfskHeaderSymbols = (p) => Math.ceil(HEADER_NIBBLES / p.channels);

export function mfskSymbolCount(p, payloadNibbles) {
  return mfskHeaderSymbols(p) + Math.ceil(payloadNibbles / p.channels);
}

/** Başlık ve veri nibble'larını kanal başına değerlere böler (eksik kalanlar 0). */
function symbolValues(headerNibbles, payloadNibbles, p) {
  const ch = p.channels;
  const symbols = [];
  for (const [nibbles, count] of [
    [headerNibbles, mfskHeaderSymbols(p)],
    [payloadNibbles, Math.ceil(payloadNibbles.length / ch)],
  ]) {
    for (let j = 0; j < count; j++) {
      const sym = [];
      for (let c = 0; c < ch; c++) sym.push(nibbles[j * ch + c] ?? 0);
      symbols.push(sym);
    }
  }
  return symbols;
}

/** Veri bölümünü out'a ekler; start: ilk sembolün başı (örnek no). */
export function renderMfsk(out, start, headerNibbles, payloadNibbles, p, fs, amplitude) {
  const symbols = symbolValues(headerNibbles, payloadNibbles, p);
  const a = amplitude / p.channels;
  const rampN = Math.max(1, Math.round(p.rampDur * fs));
  let end = 0;
  for (let j = 0; j < symbols.length; j++) {
    const s0 = Math.round(start + j * p.symbolDur * fs);
    const s1 = Math.round(start + (j + 1) * p.symbolDur * fs);
    const len = s1 - s0;
    const env = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      // yükseltilmiş kosinüs kenarlar: tık sesi ve spektral saçılma olmasın
      if (i < rampN) env[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / rampN);
      else if (i >= len - rampN) env[i] = 0.5 - 0.5 * Math.cos((Math.PI * (len - 1 - i)) / rampN);
      else env[i] = 1;
    }
    const set = j % p.sets;
    for (let c = 0; c < p.channels; c++) {
      const w = (2 * Math.PI * toneFrequency(p, c, set, symbols[j][c])) / fs;
      const phase = (c * Math.PI) / 2;
      for (let i = 0; i < len; i++) out[s0 + i] += a * env[i] * Math.sin(w * i + phase);
    }
    end = s1;
  }
  return end;
}

/** Bir profilin sembol penceresini okuyup Goertzel ile ton kararı verir (paketler arasında paylaşılır). */
export class MfskReader {
  constructor(profile, fs) {
    this.profile = profile;
    this.fs = fs;
    this.winN = Math.round(profile.windowDur * fs);
    this.skipN = Math.round(profile.skipDur * fs);
    this.window = hann(this.winN);
    this.buf = new Float32Array(this.winN);
    this.x = new Float64Array(this.winN);
    this.powers = new Float64Array(VALUES_PER_TONE);
    this.coeffs = [];
    for (let s = 0; s < profile.sets; s++) {
      const perChannel = [];
      for (let c = 0; c < profile.channels; c++) {
        const k = new Float64Array(VALUES_PER_TONE);
        for (let v = 0; v < VALUES_PER_TONE; v++) k[v] = goertzelCoeff(toneFrequency(profile, c, s, v), fs);
        perChannel.push(k);
      }
      this.coeffs.push(perChannel);
    }
  }

  windowEnd(dataStart, j) {
    return dataStart + Math.round(j * this.profile.symbolDur * this.fs) + this.skipN + this.winN;
  }

  /** j. sembolün kanal başına kararı: değer, marj (en iyi / ikinci, dB) ve SNR (dB). */
  read(store, dataStart, j) {
    if (!store.read(this.windowEnd(dataStart, j) - this.winN, this.buf)) return null;
    for (let i = 0; i < this.winN; i++) this.x[i] = this.buf[i] * this.window[i];
    const set = j % this.profile.sets;
    const values = [];
    const margins = [];
    const snrs = [];
    for (let c = 0; c < this.profile.channels; c++) {
      const p = tonePowers(this.x, this.coeffs[set][c], this.powers);
      let best = 0;
      for (let v = 1; v < VALUES_PER_TONE; v++) if (p[v] > p[best]) best = v;
      const others = [];
      for (let v = 0; v < VALUES_PER_TONE; v++) if (v !== best) others.push(p[v]);
      others.sort((a, b) => b - a);
      const tiny = 1e-20;
      values.push(best);
      margins.push(10 * Math.log10((p[best] + tiny) / (others[0] + tiny)));
      snrs.push(10 * Math.log10((p[best] + tiny) / (others[others.length >> 1] + tiny)));
    }
    return { values, margins, snrs };
  }
}

/** Tek paketin MFSK çözücüsü: paylaşılan okuyucuyu paketin başlangıcına bağlar. */
export class MfskDemod {
  constructor(reader, start) {
    this.reader = reader;
    this.start = start;
    this.payloadStart = mfskHeaderSymbols(reader.profile) * reader.profile.channels;
  }

  windowEnd(j) {
    return this.reader.windowEnd(this.start, j);
  }

  read(store, j) {
    return this.reader.read(store, this.start, j);
  }
}
