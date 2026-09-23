// Kayan spektrogram (şelale): zaman soldan sağa akar, frekans aşağıdan yukarı.
// AnalyserNode yalnız görselleştirme için kullanılır; çözme ham örneklerle yapılır.

const STOPS = [
  [0, [8, 10, 22]],
  [0.3, [49, 22, 96]],
  [0.55, [140, 41, 129]],
  [0.75, [222, 73, 104]],
  [0.9, [254, 159, 109]],
  [1, [252, 253, 191]],
];

function buildPalette() {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < STOPS.length - 2 && t > STOPS[k + 1][0]) k++;
    const [t0, c0] = STOPS[k];
    const [t1, c1] = STOPS[k + 1];
    const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * u;
  }
  return lut;
}

export class Spectrogram {
  constructor(canvas, axis) {
    this.canvas = canvas;
    this.axis = axis;
    this.g = canvas.getContext('2d', { alpha: false });
    this.lut = buildPalette();
    this.maxHz = 10000;
    this.analyser = null;
    this.running = false;
    this.onFrame = null;
    this.marks = [];
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  attach(analyser, sampleRate) {
    this.analyser = analyser;
    this.sampleRate = sampleRate;
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    this.drawAxis();
  }

  setRange(maxHz) {
    this.maxHz = maxHz;
    this.clear();
    this.drawAxis();
  }

  /** Belirli frekans bantlarını (ör. gönderilen profil) ince çizgilerle işaretler. */
  setMarks(bands) {
    this.marks = bands;
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.column = this.g.createImageData(1, h);
    this.clear();
    this.drawAxis();
  }

  clear() {
    this.g.fillStyle = 'rgb(8,10,22)';
    this.g.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawAxis() {
    if (!this.axis) return;
    const step = this.maxHz > 12000 ? 4000 : 2000;
    const labels = [];
    for (let f = step; f < this.maxHz; f += step) {
      const span = document.createElement('span');
      span.textContent = `${f / 1000}k`;
      span.style.bottom = `${(100 * f) / this.maxHz}%`; // CSSOM: CSP satır içi stil yasağına takılmaz
      labels.push(span);
    }
    this.axis.replaceChildren(...labels);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.frame();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
  }

  frame() {
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.freq);
    const { width: w, height: h } = this.canvas;
    const step = Math.max(1, Math.round(w / 600));
    this.g.drawImage(this.canvas, -step, 0);
    const binHz = this.sampleRate / 2 / this.freq.length;
    const px = this.column.data;
    for (let y = 0; y < h; y++) {
      // bir piksel satırına düşen kutuların en büyüğü: dar tonlar kaybolmasın
      const fTop = ((h - y) / h) * this.maxHz;
      const fBot = ((h - y - 1) / h) * this.maxHz;
      let v = 0;
      const b0 = Math.floor(fBot / binHz);
      const b1 = Math.min(this.freq.length - 1, Math.max(b0, Math.floor(fTop / binHz)));
      for (let b = b0; b <= b1; b++) if (this.freq[b] > v) v = this.freq[b];
      const o = y * 4;
      px[o] = this.lut[v * 3];
      px[o + 1] = this.lut[v * 3 + 1];
      px[o + 2] = this.lut[v * 3 + 2];
      px[o + 3] = 255;
    }
    for (const { lo, hi } of this.marks) {
      for (const f of [lo, hi]) {
        const y = Math.round(h - (f / this.maxHz) * h);
        if (y >= 0 && y < h) {
          const o = y * 4;
          px[o] = px[o + 1] = px[o + 2] = 200;
        }
      }
    }
    for (let s = 0; s < step; s++) this.g.putImageData(this.column, w - 1 - s, 0);
    this.onFrame?.();
  }
}
