// Alıcı tarafı: parça parça gelen ses → senkron adayları → paket çözücüleri.
// Aynı kod mikrofon akışında da, WAV dosyasında da, Node testlerinde de çalışır.

import { PROFILES, supportsProfile, symbolDuration } from './profiles.js';
import { SampleStore } from './dsp/store.js';
import { ChirpDetector } from './dsp/sync.js';
import {
  HEADER_BYTES,
  HEADER_NIBBLES,
  WEAK_DB,
  decodeHeader,
  decodePayload,
  nibblesToBytes,
  payloadLayout,
} from './codec/framing.js';
import { MfskDemod, MfskReader } from './mod/mfsk.js';
import { OfdmDemod } from './mod/ofdm.js';

const STORE_SECONDS = 12;

/** Tek bir senkron adayından başlayıp paketi çözmeye çalışır. */
class PacketDecoder {
  constructor(profile, sync, fs, reader) {
    this.profile = profile;
    this.sync = sync;
    const offset = (profile.chirp.dur + profile.gapDur) * fs;
    this.demod =
      profile.mod === 'ofdm' ? new OfdmDemod(profile, fs, sync.pos + offset) : new MfskDemod(reader, sync.pos + Math.round(offset));
    this.j = 0;
    this.nibbles = [];
    this.margins = [];
    this.snrs = [];
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
      for (let i = 0; i < res.values.length; i++) {
        this.nibbles.push(res.values[i]);
        this.margins.push(res.margins[i]);
        this.snrs.push(res.snrs[i]);
      }
      this.j++;
      if (!this.header) {
        if (this.nibbles.length < HEADER_NIBBLES) continue;
        const { bytes, conf } = nibblesToBytes(this.nibbles, this.margins, HEADER_BYTES);
        const header = decodeHeader(bytes, conf, this.profile);
        if (!header) {
          this.done = true; // sahte senkron; sessizce ele
          return;
        }
        this.header = header;
        this.layout = payloadLayout(header.length, this.profile);
        this.payloadStart = this.demod.payloadStart;
        this.payloadNibbles = this.layout.total * 2;
        rx._validated(this);
      } else {
        rx._progress(this);
        if (this.nibbles.length >= this.payloadStart + this.payloadNibbles) this.finish(rx, this.decode());
      }
    }
  }

  get received() {
    return Math.max(0, this.nibbles.length - this.payloadStart);
  }

  decode() {
    const start = this.payloadStart;
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
    this.readers = new Map(profiles.filter((p) => p.mod !== 'ofdm').map((p) => [p.key, new MfskReader(p, fs)]));
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
      const p = dec.profile;
      this.onEvent({
        type: 'sync',
        id: group.id,
        profile: p.key,
        length: dec.header.length,
        encrypted: dec.header.encrypted,
        kind: dec.header.kind,
        duration: estimatePayloadSeconds(dec),
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
      done: Math.min(dec.received, dec.payloadNibbles),
      total: dec.payloadNibbles,
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

/** Başlıktan sonra verinin sürmesi beklenen süre (s). */
function estimatePayloadSeconds(dec) {
  const p = dec.profile;
  const perSymbol = p.mod === 'ofdm' ? dec.demod.info.nibbles : p.channels;
  return Math.ceil(dec.payloadNibbles / perSymbol) * symbolDuration(p);
}
