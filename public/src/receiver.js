// Alıcı tarafı: parça parça gelen ses → senkron adayları → paket çözücüleri.
// Aynı kod mikrofon akışında da, WAV dosyasında da, Node testlerinde de çalışır.

import { PROFILES, VALUES_PER_TONE, supportsProfile, toneFrequency } from './profiles.js';
import { SampleStore } from './dsp/store.js';
import { ChirpDetector } from './dsp/sync.js';
import { goertzelCoeff, hann, tonePowers } from './dsp/filters.js';
import { HEADER_BYTES, decodeHeader, decodePayload, nibblesToBytes, payloadLayout } from './codec/framing.js';

const STORE_SECONDS = 12;
const WEAK_DB = 3;

/** Bir profilin sembol penceresini okuyup Goertzel ile ton kararı verir. */
class SymbolReader {
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
    const out = [];
    for (let c = 0; c < this.profile.channels; c++) {
      const p = tonePowers(this.x, this.coeffs[set][c], this.powers);
      let best = 0;
      for (let v = 1; v < VALUES_PER_TONE; v++) if (p[v] > p[best]) best = v;
      const others = [];
      for (let v = 0; v < VALUES_PER_TONE; v++) if (v !== best) others.push(p[v]);
      others.sort((a, b) => b - a);
      const tiny = 1e-20;
      out.push({
        value: best,
        marginDb: 10 * Math.log10((p[best] + tiny) / (others[0] + tiny)),
        snrDb: 10 * Math.log10((p[best] + tiny) / (others[others.length >> 1] + tiny)),
      });
    }
    return out;
  }
}

/** Tek bir senkron adayından başlayıp paketi çözmeye çalışır. */
class PacketDecoder {
  constructor(reader, sync, fs) {
    const p = reader.profile;
    this.reader = reader;
    this.profile = p;
    this.sync = sync;
    this.dataStart = sync.pos + Math.round((p.chirp.dur + p.gapDur) * fs);
    this.headerSymbols = (HEADER_BYTES * 2) / p.channels;
    this.j = 0;
    this.nibbles = [];
    this.margins = [];
    this.snrs = [];
    this.header = null;
    this.done = false;
    this.group = null;
  }

  step(store, rx) {
    while (!this.done && store.end >= this.reader.windowEnd(this.dataStart, this.j)) {
      const res = this.reader.read(store, this.dataStart, this.j);
      if (!res) {
        this.finish(rx, { ok: false, reason: 'buffer' });
        return;
      }
      for (const r of res) {
        this.nibbles.push(r.value);
        this.margins.push(r.marginDb);
        this.snrs.push(r.snrDb);
      }
      this.j++;
      if (!this.header && this.j === this.headerSymbols) {
        const { bytes, conf } = nibblesToBytes(this.nibbles, this.margins, HEADER_BYTES);
        const header = decodeHeader(bytes, conf, this.profile.id);
        if (!header) {
          this.done = true; // sahte senkron; sessizce ele
          return;
        }
        this.header = header;
        this.layout = payloadLayout(header.length, this.profile);
        this.payloadNibbles = this.layout.total * 2;
        this.totalSymbols = this.headerSymbols + Math.ceil(this.payloadNibbles / this.profile.channels);
        rx._validated(this);
      } else if (this.header) {
        rx._progress(this);
        if (this.j === this.totalSymbols) this.finish(rx, this.decode());
      }
    }
  }

  decode() {
    const start = HEADER_BYTES * 2;
    const end = start + this.payloadNibbles;
    const { bytes, conf } = nibblesToBytes(this.nibbles.slice(start, end), this.margins.slice(start, end), this.layout.total);
    return decodePayload(bytes, conf, this.header.length, this.profile);
  }

  stats(res) {
    const snrs = this.snrs.slice().sort((a, b) => a - b);
    return {
      rho: this.sync.rho,
      snrDb: snrs.length ? snrs[snrs.length >> 1] : 0,
      weakSymbols: this.margins.filter((m) => m < WEAK_DB).length,
      corrected: res.corrected ?? 0,
      erasures: res.erasures ?? 0,
    };
  }

  finish(rx, res) {
    this.done = true;
    rx._finished(this, res);
  }
}

/**
 * Olaylar (onEvent):
 *   { type: 'sync', id, profile, length, encrypted, symbols, duration, rho }
 *   { type: 'progress', id, profile, done, total }
 *   { type: 'message', id, profile, bytes, encrypted, stats }
 *   { type: 'fail', id, profile, reason, stats }
 */
export class Receiver {
  constructor(fs, { profiles = PROFILES, onEvent = () => {} } = {}) {
    this.fs = fs;
    this.onEvent = onEvent;
    // örnekleme hızının taşıyamadığı profiller (ör. 32 kHz'de ultrasonik) dinlenmez
    profiles = profiles.filter((p) => supportsProfile(p, fs));
    this.profiles = profiles;
    this.store = new SampleStore(Math.ceil(STORE_SECONDS * fs));
    this.detector = new ChirpDetector(fs, profiles, this.store);
    this.readers = new Map(profiles.map((p) => [p.key, new SymbolReader(p, fs)]));
    this.decoders = [];
    this.groups = [];
    this.nextId = 1;
  }

  push(samples) {
    this.store.push(samples);
    this.detector.push(samples);
    for (const s of this.detector.process()) {
      this.decoders.push(new PacketDecoder(this.readers.get(s.profile.key), s, this.fs));
    }
    for (const d of this.decoders) d.step(this.store, this);
    this.decoders = this.decoders.filter((d) => !d.done);
  }

  /** Akış bittiğinde (dosya sonu) kalan blokların işlenmesi için sessizlik ekler. */
  flush() {
    const chunk = new Float32Array(4096);
    const total = this.detector.n + Math.round(0.5 * this.fs);
    for (let i = 0; i < total; i += chunk.length) this.push(chunk);
  }

  /** Başlığı doğrulanan çözücü: aynı chirp'ten çıkan kopyalar tek grupta toplanır. */
  _validated(dec) {
    const tolerance = Math.round(dec.profile.chirp.dur * this.fs);
    let group = this.groups.find(
      (g) => g.profile === dec.profile && Math.abs(g.pos - dec.sync.pos) < tolerance && !g.closed,
    );
    if (!group) {
      group = { id: this.nextId++, profile: dec.profile, pos: dec.sync.pos, primary: dec, pending: 0, closed: false };
      this.groups.push(group);
      const p = dec.profile;
      this.onEvent({
        type: 'sync',
        id: group.id,
        profile: p.key,
        length: dec.header.length,
        encrypted: dec.header.encrypted,
        symbols: dec.totalSymbols - dec.headerSymbols,
        duration: (dec.totalSymbols - dec.headerSymbols) * p.symbolDur,
        rho: dec.sync.rho,
      });
    }
    group.pending++;
    dec.group = group;
  }

  _progress(dec) {
    const g = dec.group;
    if (g.primary !== dec || g.closed) return;
    this.onEvent({
      type: 'progress',
      id: g.id,
      profile: dec.profile.key,
      done: dec.j - dec.headerSymbols,
      total: dec.totalSymbols - dec.headerSymbols,
    });
  }

  _finished(dec, res) {
    const g = dec.group;
    if (!g) return;
    g.pending--;
    if (g.closed) return;
    if (res.ok) {
      g.closed = true;
      this.onEvent({
        type: 'message',
        id: g.id,
        profile: dec.profile.key,
        bytes: res.message,
        encrypted: dec.header.encrypted,
        stats: dec.stats(res),
      });
    } else if (g.pending === 0) {
      g.closed = true;
      this.onEvent({ type: 'fail', id: g.id, profile: dec.profile.key, reason: res.reason, stats: dec.stats(res) });
    } else if (g.primary === dec) {
      g.primary = this.decoders.find((d) => d.group === g && !d.done) ?? g.primary;
    }
    // eski grupları unut
    const horizon = this.store.end - 30 * this.fs;
    this.groups = this.groups.filter((x) => !x.closed || x.pos > horizon);
  }
}
