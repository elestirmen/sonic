// Küçük sinyal işleme yardımcıları: biquad süzgeçler, Hann penceresi, Goertzel.

const DENORMAL = 1e-25;

/** RBJ "Audio EQ Cookbook" biquad; transpoze direkt form II. */
export class Biquad {
  constructor(type, f0, fs, { q = Math.SQRT1_2, gainDb = 0 } = {}) {
    const w0 = (2 * Math.PI * f0) / fs;
    const cw = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lowpass') {
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else if (type === 'highpass') {
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else if (type === 'peaking') {
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + alpha * A;
      b1 = -2 * cw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cw;
      a2 = 1 - alpha / A;
    } else {
      throw new Error(`bilinmeyen süzgeç: ${type}`);
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    this.z1 = 0;
    this.z2 = 0;
  }

  process(x) {
    const y = this.b0 * x + this.z1;
    // Sessizlikte durumlar üstel söner ve denormal sayılara iner; işlemci onlarla ~20 kat
    // yavaş hesaplar. DENORMAL ekleyip çıkarmak, onun altındaki değerleri tam sıfıra yuvarlar.
    this.z1 = this.b1 * x - this.a1 * y + this.z2 + DENORMAL - DENORMAL;
    this.z2 = this.b2 * x - this.a2 * y + DENORMAL - DENORMAL;
    return y;
  }
}

/** Alt ve üst kesimli 4. derece bant geçiren (iki yüksek + iki alçak geçiren). */
export class BandPass {
  constructor(lo, hi, fs) {
    this.stages = [new Biquad('highpass', lo, fs), new Biquad('highpass', lo, fs)];
    if (hi < 0.45 * fs) this.stages.push(new Biquad('lowpass', hi, fs), new Biquad('lowpass', hi, fs));
  }

  process(x) {
    for (const s of this.stages) x = s.process(x);
    return x;
  }
}

export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n);
  return w;
}

export function goertzelCoeff(freq, fs) {
  return 2 * Math.cos((2 * Math.PI * freq) / fs);
}

/** x üzerinde her katsayı için |X(f)|². */
export function tonePowers(x, coeffs, out) {
  const n = x.length;
  for (let f = 0; f < coeffs.length; f++) {
    const c = coeffs[f];
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const s0 = x[i] + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    out[f] = s1 * s1 + s2 * s2 - c * s1 * s2;
  }
  return out;
}
