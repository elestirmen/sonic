// Akustik kanal benzetimi: hoparlör/mikrofon tepkisi, oda yankısı, cihaz hareketi
// (değişken gecikme → Doppler), örnekleme hızı farkı ve saat kayması, gürültü, kırpma.
// Testlerde ve tarayıcıdaki "kendi kendine test"te gerçek hoparlöre geçmeden modemi zorlamak için.

import { FFT, nextPow2 } from './fft.js';
import { BandPass, Biquad } from './filters.js';

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * Oda dürtü yanıtı: doğrudan yol + birkaç erken yansıma + üstel sönen yankı.
 * drr: doğrudan/yankı enerji oranı (dB). Küçük drr = uzak mesafe.
 */
export function roomImpulse(fs, { rt60 = 0.4, drr = 5, rand = Math.random } = {}) {
  const len = Math.max(1, Math.round(Math.min(1.5 * rt60, 1.5) * fs));
  const h = new Float32Array(len);
  h[0] = 1;
  if (rt60 <= 0) return h;
  const tail = new Float64Array(len);
  const decay = 6.91 / rt60; // genlik: e^(-6.91 t / RT60) → 60 dB
  const start = Math.round(0.003 * fs);
  for (let i = start; i < len; i++) tail[i] = gaussian(rand) * Math.exp((-decay * i) / fs);
  for (let k = 0; k < 5; k++) {
    const d = Math.round((0.002 + 0.02 * rand()) * fs);
    if (d < len) tail[d] += (rand() < 0.5 ? -1 : 1) * (0.25 + 0.35 * rand());
  }
  let e = 0;
  for (let i = 1; i < len; i++) e += tail[i] * tail[i];
  const g = Math.sqrt(Math.pow(10, -drr / 10) / (e || 1));
  for (let i = 1; i < len; i++) h[i] = tail[i] * g;
  return h;
}

export function convolve(x, h) {
  const n = nextPow2(2 * h.length);
  const block = n - h.length + 1;
  const fft = new FFT(n);
  const hr = new Float64Array(n);
  const hi = new Float64Array(n);
  hr.set(h);
  fft.transform(hr, hi);
  const out = new Float32Array(x.length + h.length - 1);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let s = 0; s < x.length; s += block) {
    re.fill(0);
    im.fill(0);
    const len = Math.min(block, x.length - s);
    for (let i = 0; i < len; i++) re[i] = x[s + i];
    fft.transform(re, im);
    for (let i = 0; i < n; i++) {
      const r = re[i] * hr[i] - im[i] * hi[i];
      im[i] = re[i] * hi[i] + im[i] * hr[i];
      re[i] = r;
    }
    fft.transform(re, im, true);
    const lim = Math.min(n, out.length - s);
    for (let i = 0; i < lim; i++) out[s + i] += re[i] / n;
  }
  return out;
}

/**
 * Cihaz hareketi: y(t) = x(t − d(t)), d(t) = (amp · sin(2π · freq · t) + speed · t) / c.
 * Elde tutma titremesi (amp ~1 cm), sallama (~3 cm) ya da sabit hızla yaklaşma (speed < 0).
 * Kübik (Catmull-Rom) ara değerleme; tüm yollara ortak gecikme (doğrudan yol baskın varsayımı).
 */
export function move(x, fs, { amp = 0, freq = 0.5, speed = 0 } = {}) {
  const c = 343;
  const base = (Math.abs(amp) + Math.abs(speed) * (x.length / fs)) / c * fs + 2; // negatif gecikme olmasın
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const t = i / fs;
    const u = i - base - ((amp * Math.sin(2 * Math.PI * freq * t) + speed * t) / c) * fs;
    const k = Math.floor(u);
    const f = u - k;
    if (k < 1 || k + 2 >= x.length) continue;
    const p0 = x[k - 1];
    const p1 = x[k];
    const p2 = x[k + 1];
    const p3 = x[k + 2];
    y[i] = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
  }
  return y;
}

/** Pencereli sinc ile yeniden örnekleme; ppm alıcı saatinin sapması. */
export function resample(x, fsIn, fsOut, ppm = 0) {
  const ratio = (fsIn / fsOut) * (1 + ppm * 1e-6);
  const cutoff = Math.min(1, 1 / ratio);
  const half = 12;
  const outLen = Math.floor(x.length / ratio);
  const out = new Float32Array(outLen);
  for (let k = 0; k < outLen; k++) {
    const u = k * ratio;
    const i0 = Math.floor(u);
    let acc = 0;
    for (let j = i0 - half + 1; j <= i0 + half; j++) {
      if (j < 0 || j >= x.length) continue;
      const d = u - j;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / half);
      const arg = Math.PI * cutoff * d;
      acc += x[j] * (d === 0 ? cutoff : (cutoff * Math.sin(arg)) / arg) * w;
    }
    out[k] = acc;
  }
  return out;
}

function rms(x) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== 0) {
      s += x[i] * x[i];
      n++;
    }
  }
  return n ? Math.sqrt(s / n) : 0;
}

/**
 * Seçenekler:
 *   fsOut, ppm           alıcı örnekleme hızı ve saat sapması
 *   delay                baştaki ek sessizlik (s)
 *   eq: [{f, gainDb, q}] hoparlör/mikrofon renklendirmesi; lowCut, highCut (Hz)
 *   rt60, drr            oda yankısı
 *   motion: {amp, freq, speed}  cihaz hareketi (m, Hz, m/sn), bkz. move()
 *   snr, noiseBand       bant içi SNR (dB) ve gürültü bandı [lo, hi]
 *   babble               konuşma benzeri girişim seviyesi (sinyale göre dB)
 *   gain, clip           kazanç ve ±1'de kırpma
 *   seed                 tekrarlanabilir rastgelelik
 */
export function simulateChannel(input, fsIn, opts = {}) {
  const rand = rng(opts.seed ?? 1);
  const fsOut = opts.fsOut ?? fsIn;
  let x = Float32Array.from(input);

  const shaping = [];
  if (opts.lowCut) shaping.push(new Biquad('highpass', opts.lowCut, fsIn), new Biquad('highpass', opts.lowCut, fsIn));
  if (opts.highCut) shaping.push(new Biquad('lowpass', opts.highCut, fsIn));
  for (const b of opts.eq ?? []) shaping.push(new Biquad('peaking', b.f, fsIn, { q: b.q ?? 1.4, gainDb: b.gainDb }));
  if (shaping.length) {
    for (let i = 0; i < x.length; i++) {
      let s = x[i];
      for (const f of shaping) s = f.process(s);
      x[i] = s;
    }
  }

  if (opts.rt60 > 0 || opts.drr !== undefined) {
    x = convolve(x, roomImpulse(fsIn, { rt60: opts.rt60 ?? 0.4, drr: opts.drr ?? 5, rand }));
  }

  if (opts.motion) x = move(x, fsIn, opts.motion);

  if (fsOut !== fsIn || opts.ppm) x = resample(x, fsIn, fsOut, opts.ppm ?? 0);

  const lead = Math.round((opts.delay ?? 0) * fsOut);
  const tail = Math.round(0.3 * fsOut);
  const y = new Float32Array(lead + x.length + tail);
  y.set(x, lead);

  const sigRms = rms(x);
  if (Number.isFinite(opts.snr)) {
    const [lo, hi] = opts.noiseBand ?? [0, 0];
    const bp = lo > 0 ? new BandPass(lo, hi, fsOut) : null;
    const noise = new Float32Array(y.length);
    for (let i = 0; i < y.length; i++) noise[i] = bp ? bp.process(gaussian(rand)) : gaussian(rand);
    const g = sigRms / Math.pow(10, opts.snr / 20) / (rms(noise) || 1);
    for (let i = 0; i < y.length; i++) y[i] += noise[i] * g;
  }

  if (Number.isFinite(opts.babble)) {
    // konuşma benzeri girişim: 4 kaynaklı, hece ritminde (~4 Hz) açılıp kapanan renkli gürültü
    const lp = new Biquad('lowpass', 3500, fsOut);
    const hp = new Biquad('highpass', 150, fsOut);
    const b = new Float32Array(y.length);
    const phases = [0, 1, 2, 3].map(() => ({ f: 3 + 3 * rand(), p: rand() * 6.28 }));
    for (let i = 0; i < y.length; i++) {
      const t = i / fsOut;
      let env = 0;
      for (const ph of phases) env += Math.max(0, Math.sin(2 * Math.PI * ph.f * t + ph.p));
      b[i] = hp.process(lp.process(gaussian(rand))) * env;
    }
    const g = sigRms / Math.pow(10, -opts.babble / 20) / (rms(b) || 1);
    for (let i = 0; i < y.length; i++) y[i] += b[i] * g;
  }

  const gain = opts.gain ?? 1;
  for (let i = 0; i < y.length; i++) {
    let s = y[i] * gain;
    if (opts.clip) s = Math.max(-1, Math.min(1, s));
    y[i] = s;
  }
  return y;
}
