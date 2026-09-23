// Alıcı tarafı: parça parça gelen ses → senkron adayları → paket çözücüleri.
// Aynı kod mikrofon akışında da, WAV dosyasında da, Node testlerinde de çalışır.

import { PROFILES, supportsProfile, symbolDuration } from './profiles.js';
import { SampleStore } from './dsp/store.js';
import { ChirpDetector } from './dsp/sync.js';
import {
  HEADER_BYTES,
  HEADER_CODED_BITS,
  HEADER_NIBBLES,
  WEAK_DB,
  convPayloadBits,
  decodeConvHeader,
  decodeConvPayload,
  decodeHeader,
  decodePayload,
  nibblesToBytes,
  payloadLayout,
} from './codec/framing.js';
import { deinterleave } from './codec/conv.js';
import { MfskDemod, MfskReader } from './mod/mfsk.js';
import { OfdmDemod } from './mod/ofdm.js';
import { CssDemod } from './mod/css.js';

const STORE_SECONDS = 12;

const median = (list) => {
  const s = list.slice().sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

/** Sert kararlı nibble akışı (MFSK, DQPSK-OFDM): marjlar RS silintilerine dönüşür. */
class NibbleCoder {
  constructor(profile, demod) {
    this.profile = profile;
    this.demod = demod;
    this.nibbles = [];
    this.margins = [];
    this.snrs = [];
  }

  push(res) {
    for (let i = 0; i < res.values.length; i++) {
      this.nibbles.push(res.values[i]);
      this.margins.push(res.margins[i]);
      this.snrs.push(res.snrs[i]);
    }
  }

  headerReady() {
    return this.nibbles.length >= HEADER_NIBBLES;
  }

  header() {
    const { bytes, conf } = nibblesToBytes(this.nibbles, this.margins, HEADER_BYTES);
    const header = decodeHeader(bytes, conf, this.profile);
    if (header) {
      this.layout = payloadLayout(header.length, this.profile);
      this.start = this.demod.payloadStart;
      this.need = this.layout.total * 2;
      this.length = header.length;
    }
    return header;
  }

  progress() {
    return { done: Math.min(this.need, Math.max(0, this.nibbles.length - this.start)), total: this.need };
  }

  payloadReady() {
    return this.nibbles.length >= this.start + this.need;
  }

  payload() {
    const end = this.start + this.need;
    const { bytes, conf } = nibblesToBytes(this.nibbles.slice(this.start, end), this.margins.slice(this.start, end), this.layout.total);
    return decodePayload(bytes, conf, this.length, this.profile);
  }

  stats() {
    return { snrDb: median(this.snrs), weakSymbols: this.margins.filter((m) => m < WEAK_DB).length };
  }

  /** Veri bölümünün süresi (s), 'sync' olayı için. */
  payloadSeconds() {
    const p = this.profile;
    const perSymbol = p.mod === 'ofdm' ? this.demod.info.nibbles : p.channels;
    return Math.ceil(this.need / perSymbol) * symbolDuration(p);
  }
}

/** Yumuşak kararlı akış (CSS): sembol başına LLR'ler; başlık ve veri ayrı ayrı Viterbi'den geçer. */
class SoftCoder {
  constructor(profile, demod) {
    this.profile = profile;
    this.bps = demod.bitsPerSymbol;
    this.headerSymbols = Math.ceil(HEADER_CODED_BITS / this.bps);
    this.symbols = [];
    this.margins = [];
    this.snrs = [];
  }

  push(res) {
    if (!res.soft) return; // başvuru sembolü
    this.symbols.push(res.soft);
    this.margins.push(res.margin);
    this.snrs.push(res.snr);
  }

  llr(from, count, n) {
    const flat = new Float32Array(count * this.bps);
    for (let j = 0; j < count; j++) flat.set(this.symbols[from + j], j * this.bps);
    return deinterleave(flat, this.bps, n);
  }

  headerReady() {
    return this.symbols.length >= this.headerSymbols;
  }

  header() {
    const header = decodeConvHeader(this.llr(0, this.headerSymbols, HEADER_CODED_BITS), this.profile);
    if (header) {
      this.length = header.length;
      this.bits = convPayloadBits(header.length, this.profile);
      this.need = Math.ceil(this.bits / this.bps);
    }
    return header;
  }

  progress() {
    return { done: Math.min(this.need, this.symbols.length - this.headerSymbols), total: this.need };
  }

  payloadReady() {
    return this.symbols.length >= this.headerSymbols + this.need;
  }

  payload() {
    return decodeConvPayload(this.llr(this.headerSymbols, this.need, this.bits), this.length, this.profile);
  }

  stats() {
    return { snrDb: median(this.snrs), weakSymbols: this.margins.filter((m) => m < WEAK_DB).length };
  }

  payloadSeconds() {
    return this.need * symbolDuration(this.profile);
  }
}

/** Tek bir senkron adayından başlayıp paketi çözmeye çalışır. */
class PacketDecoder {
  constructor(profile, sync, fs, reader) {
    this.profile = profile;
    this.sync = sync;
    const start = sync.pos + (profile.chirp.dur + profile.gapDur) * fs;
    if (profile.mod === 'ofdm') this.demod = new OfdmDemod(profile, fs, start);
    else if (profile.mod === 'css') this.demod = new CssDemod(profile, fs, start);
    else this.demod = new MfskDemod(reader, sync.pos + Math.round((profile.chirp.dur + profile.gapDur) * fs));
    this.coder = profile.conv ? new SoftCoder(profile, this.demod) : new NibbleCoder(profile, this.demod);
    this.j = 0;
    this.header = null;
    this.done = false;
    this.group = null;
  }

  step(store, rx) {
    while (!this.done && store.end >= this.demod.windowEnd(this.j)) {
      const res = this.demod.read(store, this.j);
      if (!res) {
        this.finish(rx, { ok: false, reason: 'buffer' });
        return;
      }
      this.coder.push(res);
      this.j++;
      if (!this.header) {
        if (!this.coder.headerReady()) continue;
        const header = this.coder.header();
        if (!header) {
          this.done = true; // sahte senkron; sessizce ele
          return;
        }
        this.header = header;
        rx._validated(this);
      } else {
        rx._progress(this);
        if (this.coder.payloadReady()) this.finish(rx, this.coder.payload());
      }
    }
  }

  stats(res) {
    return {
      rho: this.sync.rho,
      ...this.coder.stats(),
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
 *   { type: 'sync', id, profile, length, encrypted, kind, duration, rho }
 *   { type: 'progress', id, profile, done, total }
 *   { type: 'message', id, profile, bytes, encrypted, kind, stats }
 *   { type: 'fail', id, profile, kind, reason, stats }
 * kind: 0 metin, 1 nesne parçası (bkz. transfer.js).
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
    this.readers = new Map(profiles.filter((p) => p.mod === 'mfsk').map((p) => [p.key, new MfskReader(p, fs)]));
    this.decoders = [];
    this.groups = [];
    this.nextId = 1;
  }

  push(samples) {
    this.store.push(samples);
    this.detector.push(samples);
    for (const s of this.detector.process()) {
      for (const p of s.profiles) this.decoders.push(new PacketDecoder(p, s, this.fs, this.readers.get(p.key)));
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
      this.onEvent({
        type: 'sync',
        id: group.id,
        profile: dec.profile.key,
        length: dec.header.length,
        encrypted: dec.header.encrypted,
        kind: dec.header.kind,
        duration: dec.coder.payloadSeconds(),
        rho: dec.sync.rho,
      });
    }
    group.pending++;
    dec.group = group;
  }

  _progress(dec) {
    const g = dec.group;
    if (g.primary !== dec || g.closed) return;
    this.onEvent({ type: 'progress', id: g.id, profile: dec.profile.key, ...dec.coder.progress() });
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
        kind: dec.header.kind,
        stats: dec.stats(res),
      });
    } else if (g.pending === 0) {
      g.closed = true;
      this.onEvent({
        type: 'fail',
        id: g.id,
        profile: dec.profile.key,
        kind: dec.header.kind,
        reason: res.reason,
        stats: dec.stats(res),
      });
    } else if (g.primary === dec) {
      g.primary = this.decoders.find((d) => d.group === g && !d.done) ?? g.primary;
    }
    // eski grupları unut
    const horizon = this.store.end - 30 * this.fs;
    this.groups = this.groups.filter((x) => !x.closed || x.pos > horizon);
  }
}
