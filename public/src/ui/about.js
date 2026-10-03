// "Nasıl çalışır?" bölümü: her yöntemin bu tarayıcıda üretilen gerçek sinyalinden spektrogram,
// kısa dinleme ve ekran kanalının küçük, gerçekten okunabilen bir QR yayını. Bölüm ilk
// açıldığında bir kez hesaplanır; kapalıyken hiçbir iş yapılmaz.

import { BANDS, PROFILES, PRE_SILENCE, findProfile, netByteRate, profileBand, symbolDuration } from '../profiles.js';
import { HEADER_NIBBLES, innerCode, payloadLayout } from '../codec/framing.js';
import { MODS } from '../mod/registry.js';
import { FFT } from '../dsp/fft.js';
import { buildPalette } from './spectrogram.js';
import { VisualEncoder, frameIndices } from '../visual/protocol.js';
import { TEXT_MIME, packBody } from '../transfer.js';

const FS = 48000;
const N = 1024; // ~21 ms pencere: MFSK tonları ve chirp eğimi birlikte seçilir
const MAX_HZ = 11000; // standart bant 1–10,2 kHz
const DB_RANGE = 70;
const MAX_COLS = 960; // tuval genişliği üst sınırı (CSS ölçekler)
const CLIP = 3; // kartlarda gösterilen ve çalınan en uzun süre (s)
const SAMPLE = 'Sonik: sesle ve ekranla veri aktarımı. Bu örnek, yöntemin gerçek sinyalidir. ';
const QR_TEXT = "Merhaba! Bu küçük QR yayını Sonik'in çeşme koduyla akıyor.";
const QR_FRAMES = 12; // şeritte gösterilen ilk kareler

const num = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const utf8 = new TextEncoder();
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Kartlarda kullanılan profil: standart bantta Normal ya da ona en yakın olan. */
function demoProfile(mode) {
  for (const speed of ['normal', 'hizli', 'cok-hizli', 'saglam', 'turbo']) {
    const p = findProfile(mode, 'std', speed);
    if (p) return p;
  }
  return PROFILES.find((p) => p.mod === mode);
}

/** ~2,5 sn sinyal tutacak kadar metin: hızlı yöntemlerde de veri bölümü görünsün. */
function demoPayload(p) {
  const n = Math.max(5, Math.min(p.maxBytes, Math.round(netByteRate(p) * 2.2)));
  return utf8.encode(SAMPLE.repeat(Math.ceil(n / SAMPLE.length) + 1)).slice(0, n);
}

/** [sayı, birim]: 1000 B/sn üstü KB/sn. */
function rate(r) {
  if (r >= 1000) return [num.format(r / 1024), 'KB/sn'];
  return [r >= 100 ? String(Math.round(r)) : num.format(r), 'B/sn'];
}

function rateRange(lo, hi) {
  const [a, ua] = rate(lo);
  const [b, ub] = rate(hi);
  if (a === b && ua === ub) return `${a} ${ua}`;
  return ua === ub ? `${a}–${b} ${ub}` : `${a} ${ua} – ${b} ${ub}`;
}

function modeStats(mode) {
  const ps = PROFILES.filter((p) => p.mod === mode);
  const rates = ps.map(netByteRate);
  const lo = Math.min(...rates);
  const hi = Math.max(...rates);
  const bands = BANDS.filter((b) => ps.some((p) => p.band === b.key)).map((b) => b.name);
  return `Net ${rateRange(lo, hi)} · ${ps.length} profil · ${bands.join(', ')}`;
}

/** MFSK paketinin bölümleri (s): chirp, başlık, veri + CRC, RS eşlik. */
function packetSegments(p, length) {
  const Ts = symbolDuration(p);
  const t0 = PRE_SILENCE;
  const chirpEnd = t0 + p.chirp.dur;
  const start = chirpEnd + p.gapDur;
  if (innerCode(p)) return null; // iç kodlu yöntemlerde veri ve eşlik serpiştirilmiş
  const layout = payloadLayout(length, p);
  if (layout.blocks.length !== 1) return null; // birden çok blok serpiştirilir
  const headerSyms = MODS[p.mod].count(p, HEADER_NIBBLES, 0);
  const allSyms = MODS[p.mod].count(p, HEADER_NIBBLES, layout.total * 2);
  const payloadSyms = allSyms - headerSyms;
  const dataSyms = Math.round((payloadSyms * layout.dataLen) / layout.total);
  const headerEnd = start + headerSyms * Ts;
  const dataEnd = headerEnd + dataSyms * Ts;
  return [
    ['chirp', t0, chirpEnd],
    ['header', start, headerEnd],
    ['data', headerEnd, dataEnd],
    ['parity', dataEnd, start + allSyms * Ts],
  ];
}

export function initAbout({ details, encode, audio }) {
  const lut = buildPalette();
  const fft = new FFT(N);
  const hann = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const demos = new Map(); // figür → { samples, seconds }
  let player = null;
  let started = false;
  const qr = { timer: 0, seed: 0, encoder: null, draw: null, visible: false };

  /** Kısa zamanlı Fourier dönüşümü → tuval. Sütun başına bir pencere, her görüntü kendi tepesine göre. */
  function drawSpectrogram(canvas, samples, seconds) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.min(MAX_COLS, Math.max(120, Math.round(canvas.clientWidth * dpr)));
    const h = Math.max(60, Math.round(canvas.clientHeight * dpr));
    canvas.width = w;
    canvas.height = h;
    const total = Math.min(samples.length, Math.round(seconds * FS));
    const bins = Math.ceil(MAX_HZ / (FS / N));
    const db = new Float32Array(w * bins);
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    let peak = -Infinity;
    for (let x = 0; x < w; x++) {
      const begin = Math.round(((x + 0.5) / w) * total) - N / 2;
      for (let i = 0; i < N; i++) {
        const j = begin + i;
        re[i] = j >= 0 && j < total ? samples[j] * hann[i] : 0;
        im[i] = 0;
      }
      fft.transform(re, im);
      for (let b = 0; b < bins; b++) {
        const v = 10 * Math.log10(re[b] * re[b] + im[b] * im[b] + 1e-12);
        db[x * bins + b] = v;
        if (v > peak) peak = v;
      }
    }
    const g = canvas.getContext('2d', { alpha: false });
    const img = g.createImageData(w, h);
    const floor = peak - DB_RANGE;
    for (let y = 0; y < h; y++) {
      const f = ((h - 1 - y) / (h - 1)) * (bins - 1);
      const b0 = Math.floor(f);
      const b1 = Math.min(bins - 1, b0 + 1);
      const t = f - b0;
      for (let x = 0; x < w; x++) {
        const v = db[x * bins + b0] * (1 - t) + db[x * bins + b1] * t;
        const k = Math.max(0, Math.min(255, Math.round(((v - floor) / DB_RANGE) * 255)));
        const o = (y * w + x) * 4;
        img.data[o] = lut[k * 3];
        img.data[o + 1] = lut[k * 3 + 1];
        img.data[o + 2] = lut[k * 3 + 2];
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  async function renderDemo(figure, profile, payload, clipSeconds = CLIP) {
    const res = await encode([payload], profile.key);
    const seconds = Math.min(clipSeconds, res.samples.length / FS);
    const clip = res.samples.slice(0, Math.round(seconds * FS));
    const fade = Math.min(clip.length, Math.round(0.03 * FS)); // kesilen yerde çıt sesi olmasın
    for (let i = 0; i < fade; i++) clip[clip.length - 1 - i] *= i / fade;
    demos.set(figure, { samples: clip, seconds });
    drawSpectrogram(figure.querySelector('canvas'), clip, seconds);
    figure.dataset.ready = '';
    figure.title = `${profile.name} · ilk ${num.format(seconds)} sn · 0–11 kHz`;
    return seconds;
  }

  function showSegments(figure, profile, payload, seconds) {
    const segments = packetSegments(profile, payload.length);
    const box = figure.querySelector('.segments');
    if (!segments || !box) return;
    box.replaceChildren(
      ...segments.map(([kind, a, b]) => {
        const span = document.createElement('span');
        span.className = `seg seg-${kind}`;
        span.style.left = `${(100 * a) / seconds}%`; // CSSOM: CSP satır içi stile izin vermese de çalışır
        span.style.width = `${(100 * (Math.min(b, seconds) - a)) / seconds}%`;
        return span;
      }),
    );
  }

  async function render() {
    const anatomy = details.querySelector('[data-demo="anatomy"]');
    try {
      const mfsk = demoProfile('mfsk');
      const payload = utf8.encode('Merhaba! Bu mesaj sesle geldi.');
      const seconds = await renderDemo(anatomy, mfsk, payload, Infinity);
      showSegments(anatomy, mfsk, payload, seconds);
      for (const card of details.querySelectorAll('.mode-card')) {
        const mode = card.dataset.mode;
        card.querySelector('.stats').textContent = modeStats(mode);
        const p = demoProfile(mode);
        await nextFrame(); // her spektrogramdan sonra arayüze nefes aldır
        await renderDemo(card.querySelector('.spectro-figure'), p, demoPayload(p));
      }
    } catch (err) {
      for (const fig of details.querySelectorAll('.spectro-figure:not([data-ready])')) fig.dataset.error = err.message;
    }
  }

  function stopPlayer() {
    const p = player;
    if (!p) return;
    player = null;
    try { p.source.stop(); } catch { /* zaten bitmiş */ }
    p.figure.classList.remove('playing');
  }

  function play(figure) {
    const demo = demos.get(figure);
    if (!demo) return;
    if (player?.figure === figure) return stopPlayer();
    stopPlayer();
    const ctx = audio();
    const buffer = ctx.createBuffer(1, demo.samples.length, FS);
    buffer.copyToChannel(demo.samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    source.connect(gain);
    gain.connect(ctx.destination);
    const start = ctx.currentTime + 0.05;
    source.start(start);
    player = { source, figure, start, seconds: demo.seconds, ctx };
    figure.classList.add('playing');
    source.onended = () => { if (player?.source === source) stopPlayer(); };
    const head = figure.querySelector('.playhead');
    const tick = () => {
      if (player?.source !== source) return;
      const f = Math.max(0, Math.min(1, (ctx.currentTime - start) / demo.seconds));
      head.style.left = `${100 * f}%`;
      requestAnimationFrame(tick);
    };
    tick();
  }

  // ---------------------------------------------------------------- mini QR yayını

  async function setupQr() {
    const { encodeQr, drawQr } = await import('../visual/qr.js');
    const body = packBody({ mime: TEXT_MIME, data: utf8.encode(QR_TEXT) });
    qr.encoder = new VisualEncoder(body, { blockBytes: Math.ceil(body.length / 4) });
    const canvas = details.querySelector('#about-qr');
    const label = details.querySelector('#about-qr-label');
    const strip = details.querySelector('#about-fountain');
    const { k } = qr.encoder;
    strip.replaceChildren(
      ...Array.from({ length: QR_FRAMES }, (_, seed) => {
        const li = document.createElement('li');
        li.className = seed < k ? 'chip-data' : 'chip-repair';
        li.textContent = frameIndices(seed, k).map((i) => i + 1).sort((a, b) => a - b).join('⊕');
        li.title = seed < k ? `${seed + 1}. veri karesi` : `kurtarma karesi: ${li.textContent}`;
        return li;
      }),
    );
    qr.draw = () => {
      const seed = qr.seed;
      drawQr(canvas, encodeQr(qr.encoder.frame(seed)), 4);
      label.textContent = seed < k ? `Veri karesi ${seed + 1}/${k}` : `Kurtarma karesi · ${frameIndices(seed, k).length} parçanın XOR'u`;
      strip.querySelectorAll('li').forEach((li, i) => li.classList.toggle('current', i === seed % QR_FRAMES));
    };
    qr.draw();
    canvas.addEventListener('click', () => { qr.seed = (qr.seed + 1) % QR_FRAMES; qr.draw(); });
    new IntersectionObserver(([entry]) => {
      qr.visible = entry.isIntersecting;
      updateQrTimer();
    }).observe(canvas);
  }

  function updateQrTimer() {
    const run = qr.draw && qr.visible && details.open && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (run && !qr.timer) {
      qr.timer = setInterval(() => { qr.seed = (qr.seed + 1) % QR_FRAMES; qr.draw(); }, 900);
    } else if (!run && qr.timer) {
      clearInterval(qr.timer);
      qr.timer = 0;
    }
  }

  details.addEventListener('click', (e) => {
    const button = e.target.closest('.demo-play');
    if (button) play(button.closest('.spectro-figure'));
  });
  details.addEventListener('toggle', () => {
    if (!details.open) stopPlayer();
    updateQrTimer();
    if (!details.open || started) return;
    started = true;
    render();
    setupQr().catch(() => { details.querySelector('#about-qr-label').textContent = 'QR örneği yüklenemedi.'; });
  });
}

