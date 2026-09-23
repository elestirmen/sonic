// Chirp senkron dedektörü: gelen sesi her profilin chirp şablonuyla FFT
// üzerinden ilişkilendirir (overlap-save) ve normalize korelasyon
//   ρ[n] = Σ x[n+k]·c[k] / √(Σ x_bant[n+k]²)      (c birim enerjili)
// eşiği aştığında, 20 ms içindeki en yüksek tepeyi paket başlangıcı sayar.
// Payda bant geçiren süzülmüş enerjiyle hesaplanır; böylece bant dışındaki
// gürültü (uğultu, konuşmanın bas kısmı) ρ'yu gereksiz yere düşürmez.
//
// Yanlış alarmlar ucuzdur: her aday kendi çözücüsünü başlatır ve başlık
// doğrulanamazsa sessizce elenir. Bu yüzden eşik düşük tutulur. Aynı chirp'i
// paylaşan profiller tek şablonla aranır; aday, hepsi için birer çözücü açar.

import { FFT, nextPow2 } from './fft.js';
import { BandPass } from './filters.js';
import { SampleStore } from './store.js';
import { chirpWaveform } from './chirp.js';

const PEAK_WINDOW = 0.02;
const MIN_THRESHOLD = 0.2;
const NOISE_FACTOR = 8; // |ρ| medyanının katı (Gauss gürültüde ≈ 5.4σ)
// Uzun ve geniş bantlı chirp'te gürültünün ρ'su ~1/√(T·B) kadardır; sabit 0,2 eşiği onun
// 8σ'sının da üstünde kalır ve yankı + gürültüde (ρ ≈ 0,15–0,2) CSS paketlerini kaçırır.
const minThreshold = (c) => Math.min(MIN_THRESHOLD, Math.max(0.12, 6 / Math.sqrt(c.dur * Math.abs(c.to - c.from))));

export class ChirpDetector {
  constructor(fs, profiles, store) {
    this.fs = fs;
    this.store = store;
    const groups = new Map();
    for (const p of profiles) groups.set(p.chirp, [...(groups.get(p.chirp) ?? []), p]);
    const chirps = [...groups.keys()];
    const templates = chirps.map((c) => chirpWaveform(c, fs));
    const maxLen = Math.max(...templates.map((t) => t.length));
    this.n = nextPow2(2 * maxLen);
    this.hop = this.n - maxLen + 1;
    this.fft = new FFT(this.n);
    this.next = 0;
    this.re = new Float64Array(this.n);
    this.im = new Float64Array(this.n);
    this.pr = new Float64Array(this.n);
    this.pi = new Float64Array(this.n);
    this.seg = new Float32Array(this.n);
    this.prefix = new Float64Array(this.n + 1);
    this.peakN = Math.round(PEAK_WINDOW * fs);

    this.items = chirps.map((chirp, idx) => {
      const tpl = templates[idx];
      let energy = 0;
      for (const v of tpl) energy += v * v;
      const scale = 1 / Math.sqrt(energy);
      const cr = new Float64Array(this.n);
      const ci = new Float64Array(this.n);
      for (let i = 0; i < tpl.length; i++) cr[i] = tpl[i] * scale;
      this.fft.transform(cr, ci);
      const lo = Math.min(chirp.from, chirp.to) * 0.85;
      const hi = Math.max(chirp.from, chirp.to) * 1.12;
      return {
        profiles: groups.get(chirp),
        len: tpl.length,
        cr,
        ci,
        filter: new BandPass(lo, hi, fs),
        band: new SampleStore(Math.min(store.cap, this.n + 4 * fs)), // bir blok + gecikme payı yeter
        noise: 0.02,
        min: minThreshold(chirp),
        cand: null,
        quietUntil: 0,
      };
    });
  }

  /** Ham örnekler store'a eklendikten sonra çağrılır; bant kopyalarını günceller. */
  push(samples) {
    for (const it of this.items) {
      const out = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i++) out[i] = it.filter.process(samples[i]);
      it.band.push(out);
    }
  }

  /** Tamamlanan blokları işler; bulunan senkron adaylarını döndürür. */
  process() {
    const found = [];
    const { n, hop, re, im, pr, pi, seg, fft } = this;
    while (this.store.end >= this.next + n) {
      const m = this.next;
      if (!this.store.read(m, seg)) {
        this.next = this.store.start; // çok geride kaldık; eldeki en eski örnekten devam
        continue;
      }
      for (let i = 0; i < n; i++) {
        re[i] = seg[i];
        im[i] = 0;
      }
      fft.transform(re, im);

      // İlinti çıktıları gerçel olduğundan iki profil tek ters FFT'yi paylaşır:
      // Z = A + iB → ters FFT'nin gerçel kısmı a, sanal kısmı b olur.
      for (let k = 0; k < this.items.length; k += 2) {
        const a = this.items[k];
        const b = this.items[k + 1];
        for (let i = 0; i < n; i++) {
          // X · conj(C) → ters FFT = çapraz ilinti
          const ar = re[i] * a.cr[i] + im[i] * a.ci[i];
          const ai = im[i] * a.cr[i] - re[i] * a.ci[i];
          if (b) {
            const br = re[i] * b.cr[i] + im[i] * b.ci[i];
            const bi = im[i] * b.cr[i] - re[i] * b.ci[i];
            pr[i] = ar - bi;
            pi[i] = ai + br;
          } else {
            pr[i] = ar;
            pi[i] = ai;
          }
        }
        fft.transform(pr, pi, true);
        this.scan(a, pr, m, found);
        if (b) this.scan(b, pi, m, found);
      }
      this.next += hop;
    }
    return found;
  }

  /** Bir profilin blok ilintisini normalize edip eşik ve tepe araması yapar. */
  scan(it, corr, m, found) {
    const { n, hop, seg, prefix } = this;
    it.band.read(m, seg);
    prefix[0] = 0;
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + seg[i] * seg[i];

    const L = it.len;
    const threshold = Math.max(it.min, NOISE_FACTOR * it.noise);
    const sample = [];
    for (let i = 0; i < hop; i++) {
      const energy = prefix[i + L] - prefix[i];
      let rho = corr[i] / n / Math.sqrt(energy + 1e-12);
      if (rho > 1) rho = 1;
      if ((i & 7) === 0) sample.push(Math.abs(rho));
      const pos = m + i;
      if (it.cand) {
        if (rho > it.cand.rho) {
          it.cand.rho = rho;
          it.cand.pos = pos;
        }
        if (pos >= it.cand.deadline) {
          found.push({ profiles: it.profiles, pos: it.cand.pos, rho: it.cand.rho });
          it.quietUntil = it.cand.pos + this.peakN;
          it.cand = null;
        }
      } else if (rho > threshold && pos >= it.quietUntil) {
        it.cand = { pos, rho, deadline: pos + this.peakN };
      }
    }
    sample.sort((x, y) => x - y);
    it.noise = 0.7 * it.noise + 0.3 * sample[sample.length >> 1];
  }
}
