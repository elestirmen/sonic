// Arayüz: gönderme (metin, görsel, dosya), dinleme, dosyadan çözme, simülasyon ve geçmiş.
// Alınan içerik dışarıdan gelen güvenilmez veridir: metin DOM'a yalnız textContent ile
// yazılır, görsel ancak imzası bilinen bir raster biçimse gösterilir, dosya yalnız indirilir.

import { BANDS, MODES, PROFILES, SPEEDS, findProfile, getProfile, netByteRate, profileBand, supportsProfile } from './profiles.js';
import { estimateDuration, estimateStreamDuration } from './modem.js';
import { KIND_CHUNK, KIND_TEXT } from './codec/framing.js';
import { ObjectAssembler, TEXT_MIME, makeChunks, maxContentBytes, packBody, planChunks, unpackBody } from './transfer.js';
import { IMAGE_PRESETS, compressImage, loadImage, sniffImage } from './image.js';
import { decodeWav, encodeWav } from './audio/wav.js';
import { Spectrogram } from './ui/spectrogram.js';
import { ENCRYPTION_OVERHEAD, decryptBytes, encryptBytes } from './crypto.js';

const $ = (id) => document.getElementById(id);
const utf8 = new TextEncoder();
const num = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const HISTORY_KEY = 'sonik.history.v1';
const PREFS_KEY = 'sonik.prefs.v1';
const HISTORY_LIMIT = 60;
const HISTORY_DATA_LIMIT = 64 * 1024; // geçmişte saklanacak en büyük dosya (bayt)
const WAV_RATE = 48000;
const MAX_SECONDS = 300; // daha uzun bir yayın telefonda yüzlerce MB ses belleği ister
const MAX_FILE = Math.max(...PROFILES.map((p) => maxContentBytes(p.chunkBytes)));

const ui = {
  tabText: $('tab-text'),
  tabFile: $('tab-file'),
  paneText: $('pane-text'),
  paneFile: $('pane-file'),
  message: $('message'),
  textHint: $('text-hint'),
  byteCount: $('byte-count'),
  estimate: $('duration-estimate'),
  drop: $('drop'),
  filePick: $('file-pick'),
  cameraPick: $('camera-pick'),
  attachment: $('attachment'),
  attachmentPreview: $('attachment-preview'),
  attachmentName: $('attachment-name'),
  attachmentInfo: $('attachment-info'),
  attachmentClear: $('attachment-clear'),
  qualityField: $('quality-field'),
  qualityPicker: $('quality-picker'),
  fileEstimate: $('file-estimate'),
  methodPicker: $('method-picker'),
  methodDetail: $('method-detail'),
  experimental: $('experimental'),
  bandPicker: $('band-picker'),
  speedPicker: $('speed-picker'),
  summary: $('profile-summary'),
  volume: $('volume'),
  volumeOut: $('volume-out'),
  password: $('password'),
  sendBtn: $('send-btn'),
  wavBtn: $('wav-btn'),
  loopField: $('loop-field'),
  loop: $('loop'),
  playback: $('playback'),
  playProgress: $('play-progress'),
  playLabel: $('play-label'),
  stopBtn: $('stop-btn'),
  listenBtn: $('listen-btn'),
  status: $('status'),
  statusText: $('status-text'),
  level: $('level'),
  canvas: $('spectrogram'),
  axis: $('spectro-axis'),
  rangeBtn: $('range-btn'),
  rxBar: $('rx-bar'),
  rxProgress: $('rx-progress'),
  transfer: $('transfer'),
  transferLabel: $('transfer-label'),
  transferCount: $('transfer-count'),
  transferProgress: $('transfer-progress'),
  last: $('last-message'),
  lastImage: $('last-image'),
  lastText: $('last-text'),
  lastMeta: $('last-meta'),
  copyLast: $('copy-last'),
  saveLast: $('save-last'),
  fileInput: $('file-input'),
  selftestBtn: $('selftest-btn'),
  history: $('history'),
  historyEmpty: $('history-empty'),
  clearHistory: $('clear-history'),
  warnings: $('warnings'),
};

const state = {
  profile: 'normal',
  experimental: false,
  mode: 'text',
  quality: 'orta',
  attachment: null,
  ctx: null,
  analyser: null,
  sink: null,
  workletLoaded: false,
  busy: false,
  playing: null,
  listening: null,
  worker: null,
  requests: new Map(),
  nextRequest: 1,
  history: [],
  statusTimer: 0,
  levelBuf: null,
  assembler: new ObjectAssembler(),
  lostChunks: 0,
};

const spectrogram = new Spectrogram(ui.canvas, ui.axis);

// ---------------------------------------------------------------- tercihler

function loadJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // gizli pencere / kapalı ya da dolu depolama
  }
}

function savePrefs() {
  saveJson(PREFS_KEY, {
    profile: state.profile,
    experimental: state.experimental,
    volume: Number(ui.volume.value),
    mode: state.mode,
    quality: state.quality,
    loop: ui.loop.checked,
  });
}

// ---------------------------------------------------------------- biçimleme

function formatBytes(n) {
  if (n < 1024) return `${n} bayt`;
  if (n < 1024 * 1024) return `${num.format(n / 1024)} KB`;
  return `${num.format(n / 1024 / 1024)} MB`;
}

/** Net bilgi hızı (evrişimli kod ve RS payı düşülmüş); yöntemler arası karşılaştırma için. */
function formatRate(p) {
  const r = netByteRate(p);
  if (r >= 1000) return `${num.format(r / 1024)} KB/sn`;
  return `${r >= 100 ? Math.round(r) : num.format(r)} B/sn`;
}

function formatSeconds(s) {
  if (s < 90) return `${num.format(s)} sn`;
  const m = Math.floor(s / 60);
  return `${m} dk ${Math.round(s - 60 * m)} sn`;
}

const khz = (hz) => num.format(hz / 1000);

function bandRange(method, key) {
  const bands = PROFILES.filter((p) => p.mod === method && p.band === key).map(profileBand);
  if (!bands.length) return '—';
  const lo = Math.floor(Math.min(...bands.map((b) => b.lo)) / 500) * 500;
  const hi = Math.ceil(Math.max(...bands.map((b) => b.hi)) / 500) * 500;
  return `${khz(lo)}–${khz(hi)} kHz`;
}

// ---------------------------------------------------------------- profil ve tahmin

function choice(key, title, subtitle, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.dataset.key = key;
  b.innerHTML = '<strong></strong><small></small>';
  b.querySelector('strong').textContent = title;
  b.querySelector('small').textContent = subtitle;
  b.addEventListener('click', onClick);
  return b;
}

function badge(text) {
  const span = document.createElement('span');
  span.className = 'badge';
  span.textContent = text;
  return span;
}

const modeOf = (p) => MODES.find((m) => m.key === p.mod);

function renderMethods() {
  const modes = MODES.filter((m) => (state.experimental || !m.experimental) && PROFILES.some((p) => p.mod === m.key));
  ui.methodPicker.className = `segmented method n${modes.length}`;
  ui.methodPicker.replaceChildren(
    ...modes.map((m) => {
      const b = choice(m.key, `Mod ${m.num} · ${m.name}`, m.title, () => selectMethod(m.key));
      if (m.experimental) b.append(badge('deneysel'));
      return b;
    }),
  );
}

/** Deneysel yöntemler (Mod 2, 3) kapalıyken seçili profil Mod 1'in en yakın profiline döner. */
function setExperimental(on, persist = true) {
  state.experimental = on;
  ui.experimental.checked = on;
  renderMethods();
  const cur = getProfile(state.profile);
  const p = !on && modeOf(cur).experimental ? nearest('mfsk', cur.band, cur.speed) : cur;
  selectProfile(p.key, persist);
}

function renderPickers() {
  ui.bandPicker.replaceChildren(...BANDS.map((b) => choice(b.key, b.name, '', () => selectBand(b.key))));
  ui.qualityPicker.replaceChildren(
    ...IMAGE_PRESETS.map((q) =>
      choice(q.key, q.name, q.maxDim ? `≤ ${q.maxDim} px` : 'değiştirme', () => selectQuality(q.key)),
    ),
  );
  for (const b of ui.qualityPicker.children) b.setAttribute('aria-checked', String(b.dataset.key === state.quality));
  setExperimental(state.experimental, false);
}

function renderProfileTable() {
  const body = $('profile-table');
  const order = (p) =>
    MODES.findIndex((m) => m.key === p.mod) * 100 +
    BANDS.findIndex((b) => b.key === p.band) * 10 +
    SPEEDS.findIndex((s) => s.key === p.speed);
  body.replaceChildren(
    ...PROFILES.slice()
      .sort((a, b) => order(a) - order(b))
      .map((p) => {
        const band = profileBand(p);
        const method = modeOf(p);
        const tr = document.createElement('tr');
        for (const text of [`${method.num} · ${method.name}`, p.name, formatRate(p), `${khz(band.lo)}–${khz(band.hi)} kHz`, p.summary]) {
          const td = document.createElement('td');
          td.textContent = text;
          tr.append(td);
        }
        if (method.experimental) tr.firstChild.append(badge('deneysel'));
        return tr;
      }),
  );
}

/** Yöntemin sunduğu hız kademeleri (bantların birleşimi), yavaştan hızlıya. */
const speedsOf = (method) => SPEEDS.filter((s) => PROFILES.some((p) => p.mod === method && p.speed === s.key));

function selectProfile(key, persist = true) {
  state.profile = key;
  const p = getProfile(key);
  const method = modeOf(p);
  for (const b of ui.methodPicker.children) b.setAttribute('aria-checked', String(b.dataset.key === p.mod));
  ui.methodDetail.textContent = method.detail;
  for (const b of ui.bandPicker.children) {
    const range = bandRange(p.mod, b.dataset.key);
    b.disabled = range === '—';
    b.querySelector('small').textContent = range;
    b.setAttribute('aria-checked', String(b.dataset.key === p.band));
  }
  if (ui.speedPicker.dataset.method !== p.mod) {
    const speeds = speedsOf(p.mod);
    ui.speedPicker.dataset.method = p.mod;
    ui.speedPicker.className = `segmented n${speeds.length}`;
    ui.speedPicker.replaceChildren(...speeds.map((sp) => choice(sp.key, sp.name, '', () => selectSpeed(sp.key))));
  }
  for (const b of ui.speedPicker.children) {
    const q = findProfile(p.mod, p.band, b.dataset.key);
    b.disabled = !q;
    b.title = q ? q.summary : 'bu bantta yok';
    b.querySelector('small').textContent = q ? formatRate(q) : '—';
    b.setAttribute('aria-checked', String(b.dataset.key === p.speed));
  }
  const band = profileBand(p);
  ui.summary.textContent = `${p.summary} · ${khz(band.lo)}–${khz(band.hi)} kHz · net ${formatRate(p)}`;
  spectrogram.setMarks([band]);
  if (band.hi > spectrogram.maxHz) setRange(20000);
  updateEstimate();
  if (persist) savePrefs();
}

/** Aynı yöntem ve bantta istenen hıza en yakın profil (eşitlikte yavaş olan). */
function nearest(method, band, speed) {
  const speeds = SPEEDS.map((sp) => sp.key);
  const i = speeds.indexOf(speed);
  const byDistance = speeds.map((k, j) => ({ k, d: Math.abs(j - i) + (j > i ? 0.5 : 0) })).sort((a, b) => a.d - b.d);
  for (const { k } of byDistance) {
    const p = findProfile(method, band, k);
    if (p) return p;
  }
  return null;
}

function selectMethod(method) {
  const cur = getProfile(state.profile);
  const p = nearest(method, cur.band, cur.speed) ?? nearest(method, 'std', cur.speed);
  if (p) selectProfile(p.key);
}

function selectBand(band) {
  const cur = getProfile(state.profile);
  const p = nearest(cur.mod, band, cur.speed);
  if (p) selectProfile(p.key);
}

function selectSpeed(speed) {
  const cur = getProfile(state.profile);
  const p = findProfile(cur.mod, cur.band, speed);
  if (p) selectProfile(p.key);
}

function selectQuality(key) {
  state.quality = key;
  for (const b of ui.qualityPicker.children) b.setAttribute('aria-checked', String(b.dataset.key === key));
  savePrefs();
  prepareAttachment();
}

function setMode(mode, persist = true) {
  state.mode = mode;
  const file = mode === 'file';
  ui.tabText.setAttribute('aria-selected', String(!file));
  ui.tabFile.setAttribute('aria-selected', String(file));
  ui.tabText.tabIndex = file ? -1 : 0;
  ui.tabFile.tabIndex = file ? 0 : -1;
  ui.paneText.hidden = file;
  ui.paneFile.hidden = !file;
  updateEstimate();
  if (persist) savePrefs();
}

/** Gövde boyutu: bkz. transfer.js packBody. */
const bodyBytes = (name, mime, n) => 3 + Math.min(255, utf8.encode(name).length) + utf8.encode(mime).length + n + 4;

/**
 * Seçili içeriğin nasıl gönderileceği: tek paket mi, parçalı nesne mi; paket boyları.
 * null: gönderilecek bir şey yok; { tooBig } : bu profille taşınamaz.
 */
function currentPlan() {
  const p = getProfile(state.profile);
  const enc = ui.password.value ? ENCRYPTION_OVERHEAD : 0;
  let content;
  if (state.mode === 'text') {
    const n = utf8.encode(ui.message.value).length;
    if (n === 0) return null;
    if (n + enc <= p.maxBytes) return { single: true, bytes: n, lengths: [n + enc] };
    content = bodyBytes('', TEXT_MIME, n) + enc;
  } else {
    const f = state.attachment?.prepared;
    if (!f) return null;
    content = bodyBytes(f.name, f.mime, f.data.length) + enc;
  }
  if (content > maxContentBytes(p.chunkBytes)) return { tooBig: true, bytes: content };
  const plan = { single: false, bytes: content, ...objectPlan(content, p) };
  if (plan.seconds > MAX_SECONDS) return { tooBig: true, tooLong: true, bytes: content, seconds: plan.seconds };
  return plan;
}

/** Nesnenin parçalanışı; gönderirken de aynı hesap kullanılır. */
function objectPlan(contentBytes, p) {
  return planChunks(contentBytes, p.chunkBytes, (bytes, count) => estimateStreamDuration(new Array(count).fill(bytes), p));
}

function planDuration(plan) {
  return plan.single ? estimateDuration(plan.lengths[0], getProfile(state.profile)) : plan.seconds;
}

function updateEstimate() {
  const plan = currentPlan();
  const ok = !!plan && !plan.tooBig;
  if (state.mode === 'text') {
    const n = utf8.encode(ui.message.value).length;
    ui.byteCount.textContent = formatBytes(n);
    ui.textHint.classList.toggle('over', !!plan?.tooBig);
    ui.estimate.textContent = !plan
      ? ''
      : plan.tooBig
        ? 'bu profil için çok uzun'
        : `≈ ${formatSeconds(planDuration(plan))}${plan.single ? '' : ` · ${plan.k + plan.m} paket`}`;
  } else {
    ui.fileEstimate.classList.toggle('over', !!plan?.tooBig);
    ui.fileEstimate.textContent = !plan
      ? ''
      : plan.tooLong
        ? `${formatBytes(plan.bytes)}: bu profille ≈ ${formatSeconds(plan.seconds)} sürer (en çok ${MAX_SECONDS / 60} dk). Görseli küçült ya da daha hızlı bir profil seç.`
        : plan.tooBig
          ? `${formatBytes(plan.bytes)}: bu profil için çok büyük (en çok ${formatBytes(maxContentBytes(getProfile(state.profile).chunkBytes))}). Görseli küçült ya da daha hızlı bir profil seç.`
          : `${formatBytes(plan.bytes)} · ${plan.k + plan.m} paket (herhangi ${plan.k} tanesi yeter) · ≈ ${formatSeconds(planDuration(plan))}`;
  }
  ui.loopField.hidden = !ok || plan.single;
  ui.sendBtn.disabled = !ok || !!state.playing || state.busy;
  ui.wavBtn.disabled = !ok || state.busy;
  ui.selftestBtn.disabled = !ok || state.busy;
}

// ---------------------------------------------------------------- ek (görsel/dosya)

const isImageFile = (file) => /^image\/(png|jpeg|webp|gif|avif|bmp|heic|heif)$/.test(file.type);

async function setAttachment(file) {
  if (!file) return;
  setMode('file');
  const att = { file, name: file.name || 'dosya', mime: file.type || 'application/octet-stream', img: null, prepared: null };
  state.attachment = att;
  ui.attachment.hidden = false;
  ui.attachmentName.textContent = att.name;
  ui.attachmentInfo.textContent = 'hazırlanıyor…';
  ui.attachmentPreview.hidden = true;
  if (isImageFile(file)) {
    try {
      att.img = await loadImage(file);
    } catch {
      att.img = null; // çözülemeyen görsel dosya gibi gönderilir
    }
  }
  if (state.attachment === att) await prepareAttachment();
}

function clearAttachment() {
  state.attachment = null;
  ui.attachment.hidden = true;
  ui.qualityField.hidden = true;
  ui.filePick.value = '';
  ui.cameraPick.value = '';
  updateEstimate();
}

/** Görseli seçili boyuta küçültür ya da dosyayı olduğu gibi okur. */
async function prepareAttachment() {
  const att = state.attachment;
  if (!att) return;
  const token = (att.token = {});
  att.prepared = null;
  ui.qualityField.hidden = !att.img;
  updateEstimate();
  try {
    let prepared;
    if (att.img && state.quality !== 'orijinal') {
      const preset = IMAGE_PRESETS.find((q) => q.key === state.quality);
      const res = await compressImage(att.img, preset);
      const ext = res.type === 'image/webp' ? 'webp' : 'jpg';
      prepared = { name: att.name.replace(/\.[^.]*$/, '') + `.${ext}`, mime: res.type, data: res.bytes, width: res.width, height: res.height };
    } else {
      if (att.file.size > MAX_FILE) throw new Error(`dosya çok büyük (${formatBytes(att.file.size)}); en çok ${formatBytes(MAX_FILE)}`);
      prepared = { name: att.name, mime: att.mime, data: new Uint8Array(await att.file.arrayBuffer()) };
      if (att.img) Object.assign(prepared, { width: att.img.naturalWidth, height: att.img.naturalHeight });
    }
    if (att.token !== token) return; // bu arada başka dosya ya da boyut seçildi
    att.prepared = prepared;
    const image = sniffImage(prepared.data);
    ui.attachmentPreview.hidden = !image;
    if (image) ui.attachmentPreview.src = dataUrl(image.type, prepared.data);
    const parts = [formatBytes(prepared.data.length)];
    if (prepared.width) parts.push(`${prepared.width}×${prepared.height}`);
    if (att.img && state.quality !== 'orijinal') parts.push(`asıl: ${formatBytes(att.file.size)}`);
    ui.attachmentName.textContent = prepared.name;
    ui.attachmentInfo.textContent = parts.join(' · ');
  } catch (err) {
    if (att.token !== token) return;
    ui.attachmentInfo.textContent = `Hazırlanamadı: ${err.message}`;
  }
  updateEstimate();
}

// ---------------------------------------------------------------- ses bağlamı

function audio() {
  if (!state.ctx) {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = -110;
    analyser.maxDecibels = -25;
    // Bazı tarayıcılar çıkışı hedefe bağlı olmayan düğümleri işlemez; sessiz bir yol açık kalır.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    analyser.connect(sink);
    sink.connect(ctx.destination);
    Object.assign(state, { ctx, analyser, sink, levelBuf: new Float32Array(analyser.fftSize) });
    spectrogram.attach(analyser, ctx.sampleRate);
    spectrogram.onFrame = updateLevel;
  }
  if (state.ctx.state === 'suspended') state.ctx.resume();
  return state.ctx;
}

function setAudioSession(type) {
  try {
    if (navigator.audioSession) navigator.audioSession.type = type;
  } catch {
    // yalnız Safari'de var; yoksa önemi yok
  }
}

function updateLevel() {
  const buf = state.levelBuf;
  state.analyser.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  const db = 10 * Math.log10(s / buf.length + 1e-12);
  ui.level.style.width = `${Math.max(0, Math.min(100, ((db + 70) / 70) * 100))}%`;
  ui.level.classList.toggle('hot', db > -6);
}

function refreshSpectrogram() {
  if (state.playing || state.listening) {
    spectrogram.start();
  } else {
    spectrogram.stop();
    ui.level.style.width = '0%';
  }
}

function setRange(maxHz) {
  spectrogram.setRange(maxHz);
  ui.rangeBtn.textContent = maxHz > 12000 ? '0–20 kHz' : '0–10 kHz';
}

// ---------------------------------------------------------------- gönderme

/** Gönderilecek paketler: kısa metin tek paket, gerisi parçalı nesne. */
async function buildJob() {
  const p = getProfile(state.profile);
  const password = ui.password.value;
  const encrypted = !!password;
  let body;
  let item;
  if (state.mode === 'text') {
    const text = ui.message.value;
    const bytes = utf8.encode(text);
    const single = encrypted ? await encryptBytes(bytes, password) : bytes;
    if (single.length <= p.maxBytes) return { payloads: [single], kind: KIND_TEXT, encrypted, item: { kind: 'text', text } };
    body = packBody({ mime: TEXT_MIME, data: bytes });
    item = { kind: 'text', text };
  } else {
    const f = state.attachment.prepared;
    body = packBody({ name: f.name, mime: f.mime, data: f.data });
    item = describeObject(f, {});
  }
  const content = encrypted ? await encryptBytes(body, password) : body;
  const id = crypto.getRandomValues(new Uint16Array(1))[0];
  return { payloads: makeChunks(content, objectPlan(content.length, p).chunkBytes, id), kind: KIND_CHUNK, encrypted, item };
}

async function send() {
  if (state.playing || state.busy) return;
  const ctx = audio(); // kullanıcı dokunuşu sırasında: iOS sesi ancak böyle açar
  const profile = getProfile(state.profile);
  if (!supportsProfile(profile, ctx.sampleRate)) {
    return warn(`Bu cihazın ses çıkışı (${ctx.sampleRate} Hz) ${profile.name} profilini çalamıyor.`);
  }
  state.busy = true;
  updateEstimate();
  try {
    const job = await buildJob();
    const loop = ui.loop.checked && job.payloads.length > 1;
    if (job.payloads.length > 1) setStatus(state.listening ? 'listening' : 'idle', 'Ses hazırlanıyor…');
    const res = await request({
      type: 'encode',
      payloads: job.payloads,
      profile: profile.key,
      sampleRate: ctx.sampleRate,
      kind: job.kind,
      encrypted: job.encrypted,
      amplitude: 0.9,
    });
    play(res.samples, res.duration, loop);
    addHistory({ dir: 'out', profile: profile.key, encrypted: job.encrypted, ...job.item });
    if (job.payloads.length > 1) {
      setStatus(state.listening ? 'listening' : 'idle', state.listening ? 'Dinleniyor…' : 'Hazır');
    }
  } catch (err) {
    warn(`Gönderilemedi: ${err.message}`);
  } finally {
    state.busy = false;
    updateEstimate();
  }
}

function play(samples, duration, loop) {
  const ctx = state.ctx;
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = loop;
  const gain = ctx.createGain();
  gain.gain.value = Number(ui.volume.value) / 100;
  source.connect(gain);
  gain.connect(ctx.destination);
  gain.connect(state.analyser);
  setAudioSession(state.listening ? 'play-and-record' : 'playback');
  const start = ctx.currentTime + 0.05;
  source.start(start);
  state.playing = { source, start, duration, loop };
  source.onended = () => {
    state.playing = null;
    ui.playback.hidden = true;
    updateEstimate();
    refreshSpectrogram();
  };
  ui.playback.hidden = false;
  animatePlayback();
  refreshSpectrogram();
}

function animatePlayback() {
  const p = state.playing;
  if (!p) return;
  const t = Math.max(0, state.ctx.currentTime - p.start);
  const round = Math.floor(t / p.duration);
  const f = p.loop ? t / p.duration - round : Math.min(1, t / p.duration);
  ui.playProgress.style.width = `${100 * f}%`;
  ui.playLabel.textContent = p.loop ? `${round + 1}. tur` : formatSeconds(Math.max(0, p.duration - t));
  requestAnimationFrame(animatePlayback);
}

function stopPlayback() {
  try {
    state.playing?.source.stop();
  } catch {
    // zaten durmuş
  }
}

async function downloadWav() {
  if (state.busy) return;
  state.busy = true;
  updateEstimate();
  try {
    const job = await buildJob();
    const res = await request({
      type: 'encode',
      payloads: job.payloads,
      profile: state.profile,
      sampleRate: WAV_RATE,
      kind: job.kind,
      encrypted: job.encrypted,
      amplitude: 0.9,
    });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    saveBlob(new Blob([encodeWav(res.samples, WAV_RATE)], { type: 'audio/wav' }), `sonik-${state.profile}-${stamp}.wav`);
  } catch (err) {
    warn(`WAV oluşturulamadı: ${err.message}`);
  } finally {
    state.busy = false;
    updateEstimate();
  }
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------------------------------------------------------------- dinleme

function worker() {
  if (!state.worker) {
    const w = new Worker(new URL('./receiver-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => onWorkerMessage(e.data);
    w.onerror = (e) => warn(`Çözücü başlatılamadı: ${e.message ?? 'bilinmeyen hata'}`);
    state.worker = w;
  }
  return state.worker;
}

async function startListening() {
  if (!navigator.mediaDevices?.getUserMedia) return warn('Bu tarayıcı mikrofon erişimini desteklemiyor.');
  if (!window.isSecureContext) return warn('Mikrofon için sayfanın HTTPS üzerinden açılması gerekir.');
  const ctx = audio();
  ui.listenBtn.disabled = true;
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const settings = stream.getAudioTracks()[0]?.getSettings?.() ?? {};
    const processing = ['echoCancellation', 'noiseSuppression', 'autoGainControl'].filter((k) => settings[k] === true);
    if (processing.length) {
      warn('Tarayıcı mikrofon ses işlemesini kapatmadı; tonlar bastırılabilir. Başka bir tarayıcı deneyin.');
    }
    if (!state.workletLoaded) {
      await ctx.audioWorklet.addModule(new URL('./audio/capture-worklet.js', import.meta.url));
      state.workletLoaded = true;
    }
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'sonik-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    source.connect(node);
    node.connect(state.sink);
    source.connect(state.analyser);
    const w = worker();
    w.postMessage({ type: 'start', sampleRate: ctx.sampleRate });
    node.port.onmessage = (e) => w.postMessage({ type: 'samples', data: e.data }, [e.data.buffer]);
    state.listening = { stream, source, node };
    setAudioSession('play-and-record');
    setStatus('listening', 'Dinleniyor…');
    ui.listenBtn.textContent = 'Dinlemeyi durdur';
    ui.listenBtn.classList.add('active');
    refreshSpectrogram();
  } catch (err) {
    for (const t of stream?.getTracks() ?? []) t.stop(); // yarıda kaldıysa mikrofon açık kalmasın
    const reason =
      err.name === 'NotAllowedError'
        ? 'Mikrofon izni verilmedi.'
        : err.name === 'NotFoundError'
          ? 'Mikrofon bulunamadı.'
          : `Mikrofon açılamadı: ${err.message}`;
    warn(reason);
  } finally {
    ui.listenBtn.disabled = false;
  }
}

function stopListening() {
  const l = state.listening;
  if (!l) return;
  l.node.port.onmessage = null;
  l.source.disconnect();
  l.node.disconnect();
  for (const t of l.stream.getTracks()) t.stop();
  state.worker?.postMessage({ type: 'stop' });
  state.listening = null;
  ui.listenBtn.textContent = 'Dinlemeyi başlat';
  ui.listenBtn.classList.remove('active');
  ui.rxBar.hidden = true;
  setStatus('idle', 'Hazır');
  setAudioSession('playback');
  refreshSpectrogram();
}

function setStatus(kind, text, revertMs = 0) {
  clearTimeout(state.statusTimer);
  ui.status.dataset.kind = kind;
  ui.statusText.textContent = text;
  if (revertMs) {
    state.statusTimer = setTimeout(() => {
      if (state.listening) setStatus('listening', 'Dinleniyor…');
      else setStatus('idle', 'Hazır');
    }, revertMs);
  }
}

function onWorkerMessage(m) {
  if (m.type === 'event') return onLiveEvent(m.event);
  const req = state.requests.get(m.id);
  if (!req) return;
  state.requests.delete(m.id);
  if (m.type === 'error') req.reject(new Error(m.message));
  else req.resolve(m);
}

function request(msg, transfer = []) {
  const id = state.nextRequest++;
  return new Promise((resolve, reject) => {
    state.requests.set(id, { resolve, reject });
    worker().postMessage({ ...msg, id }, transfer);
  });
}

async function onLiveEvent(ev) {
  const p = getProfile(ev.profile);
  switch (ev.type) {
    case 'sync':
      setStatus(
        'rx',
        ev.kind === KIND_CHUNK
          ? `Parça yakalandı · ${p.name}${ev.encrypted ? ' · şifreli' : ''}`
          : `Sinyal yakalandı · ${p.name} · ${formatBytes(ev.length)}${ev.encrypted ? ' · şifreli' : ''}`,
      );
      ui.rxBar.hidden = false;
      ui.rxProgress.style.width = '0%';
      break;
    case 'progress':
      ui.rxProgress.style.width = `${(100 * ev.done) / ev.total}%`;
      ui.statusText.textContent = `Çözülüyor · ${p.name} · %${Math.round((100 * ev.done) / ev.total)}`;
      break;
    case 'message': {
      ui.rxBar.hidden = true;
      if (ev.kind === KIND_CHUNK) return onChunk(ev);
      const item = await receivedText(ev, 'in');
      showLast(item);
      addHistory(item);
      setStatus('ok', item.locked ? 'Şifreli mesaj alındı' : 'Mesaj alındı', 5000);
      break;
    }
    case 'fail':
      ui.rxBar.hidden = true;
      if (ev.kind === KIND_CHUNK && state.assembler.pending().length) {
        state.lostChunks++;
        updateTransfer();
        setStatus('fail', 'Bir parça çözülemedi; gönderen tekrarlarsa sonraki turda tamamlanır.', 5000);
      } else {
        setStatus('fail', 'Çözülemedi: sinyal zayıf ya da bozuk. Sesi açın ya da yaklaşın.', 6000);
      }
      break;
  }
}

/** Canlı dinlemede gelen nesne parçası. */
async function onChunk(ev) {
  const res = state.assembler.add(ev.bytes, { encrypted: ev.encrypted, profile: ev.profile });
  if (!res) return;
  if (!res.fresh) {
    updateTransfer();
    if (!res.done) setStatus('rx', `Parça alındı · ${res.have}/${res.need}`);
    return;
  }
  state.lostChunks = 0;
  updateTransfer();
  if (res.error) return setStatus('fail', `İçerik kurulamadı: ${res.error}`, 6000);
  const item = await receivedObject(res.content, ev, 'in');
  showLast(item);
  addHistory(item);
  setStatus('ok', item.locked ? 'Şifreli içerik alındı' : item.kind === 'file' ? `${item.image ? 'Görsel' : 'Dosya'} alındı` : 'Mesaj alındı', 5000);
}

function updateTransfer() {
  const pending = state.assembler.pending().at(-1);
  ui.transfer.hidden = !pending;
  if (!pending) return;
  ui.transferLabel.textContent = 'Parçalı içerik alınıyor';
  const lost = state.lostChunks ? ` · ${state.lostChunks} bozuk` : '';
  ui.transferCount.textContent = `${Math.min(pending.have, pending.need)}/${pending.need} parça${lost}`;
  ui.transferProgress.style.width = `${(100 * Math.min(pending.have, pending.need)) / pending.need}%`;
}

// ---------------------------------------------------------------- dosya ve simülasyon

async function decodeFile(file) {
  setStatus('rx', `Dosya çözülüyor: ${file.name}`);
  try {
    const buf = await file.arrayBuffer();
    let samples;
    let sampleRate;
    try {
      ({ samples, sampleRate } = decodeWav(buf));
    } catch {
      // WAV değilse (mp3, m4a, ogg…) tarayıcının çözücüsü; bağlamın hızına örnekler
      const decoded = await audio().decodeAudioData(buf.slice(0));
      samples = decoded.getChannelData(0).slice(); // AudioBuffer'ın kendi belleği aktarılamaz
      sampleRate = decoded.sampleRate;
    }
    const res = await request({ type: 'decode', sampleRate, data: samples }, [samples.buffer]);
    await reportBatch(res, 'file', `${file.name}`);
  } catch (err) {
    setStatus('fail', `Dosya çözülemedi: ${err.message}`, 6000);
  } finally {
    ui.fileInput.value = '';
  }
}

/**
 * Profilin amaçlandığı koşula uygun bir oda: Turbo yan yana, Çok hızlı ~1 m, CSS uzak ve gürültülü.
 * Profil kendi koşulunu p.sim = { label, channel } ile verebilir.
 */
function simulationFor(p) {
  const band = profileBand(p);
  const base = { noiseBand: [band.lo * 0.5, Math.min(23000, band.hi * 1.5)], lowCut: 250, delay: 0.3 };
  if (p.sim) return { label: p.sim.label, channel: { ...base, ...p.sim.channel } };
  if (p.mod === 'css') {
    if (p.speed === 'saglam') return { label: 'çok uzak, yankılı salon, gürültü sinyalden 8 dB güçlü', channel: { ...base, rt60: 1.0, drr: -8, snr: -8 } };
    if (p.speed === 'normal') return { label: 'uzak, yankılı salon, gürültü sinyalden 5 dB güçlü', channel: { ...base, rt60: 0.8, drr: -5, snr: -5 } };
    return { label: 'uzak oda, gürültü sinyal kadar güçlü', channel: { ...base, rt60: 0.6, drr: -3, snr: 0 } };
  }
  if (p.speed === 'turbo') return { label: 'yan yana, hafif yankı', channel: { ...base, rt60: 0.4, drr: 12, snr: 20 } };
  if (p.speed === 'cok-hizli') return { label: '1 m, yankılı oda + gürültü', channel: { ...base, rt60: 0.45, drr: 2, snr: 15 } };
  return { label: 'yankılı oda + gürültü', channel: { ...base, rt60: 0.45, drr: 0, snr: 10 } };
}

async function selftest() {
  if (state.busy) return;
  state.busy = true;
  updateEstimate();
  const profile = getProfile(state.profile);
  const sim = simulationFor(profile);
  setStatus('rx', `Simülasyon: ${sim.label}…`);
  try {
    const job = await buildJob();
    const res = await request({
      type: 'selftest',
      payloads: job.payloads,
      profile: profile.key,
      kind: job.kind,
      encrypted: job.encrypted,
      channel: sim.channel,
    });
    await reportBatch(res, 'sim', 'simülasyon');
  } catch (err) {
    setStatus('fail', `Simülasyon hatası: ${err.message}`, 6000);
  } finally {
    state.busy = false;
    updateEstimate();
  }
}

/** Bir kayıttan ya da simülasyondan çıkan olayların hepsi: metinler ve kurulan nesneler. */
async function reportBatch(res, dir, label) {
  const assembler = new ObjectAssembler();
  const items = [];
  let failed = res.events.filter((e) => e.type === 'fail').length;
  let partial = null;
  for (const ev of res.events) {
    if (ev.type !== 'message') continue;
    if (ev.kind !== KIND_CHUNK) {
      items.push(await receivedText(ev, dir));
      continue;
    }
    const r = assembler.add(ev.bytes, { encrypted: ev.encrypted, profile: ev.profile });
    if (!r) continue;
    if (r.fresh && r.content) items.push(await receivedObject(r.content, ev, dir));
    else if (r.fresh) failed++;
    else if (!r.done) partial = r;
  }
  for (const item of items) {
    addHistory(item);
    showLast(item);
  }
  const speed = res.seconds / (res.ms / 1000);
  const pending = assembler.pending().at(-1) ?? partial;
  const summary = items.length
    ? `${label}: ${items.length} öğe çözüldü (${formatSeconds(res.seconds)} ses, ${Math.round(speed)}× gerçek zaman)`
    : pending
      ? `${label}: içerik eksik kaldı (${pending.have}/${pending.need} parça)`
      : `${label}: mesaj bulunamadı${failed ? ` (${failed} paket bozuk)` : ''}`;
  setStatus(items.length ? 'ok' : 'fail', summary, 7000);
}

// ---------------------------------------------------------------- alınan içerik

const toBase64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const utf8Text = (bytes) => new TextDecoder('utf-8', { fatal: false }).decode(bytes);
const dataUrl = (type, bytes) => `data:${type};base64,${toBase64(bytes)}`;

/** Dosya adı: yol ayırıcı ve denetim karakterleri atılır, gizli dosya adı olmaz. */
function safeName(name, image) {
  let n = name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '_').trim().slice(0, 120);
  n = n.replace(/^\.+/, '');
  if (!n) n = 'sonik-dosya';
  if (image && !/\.[a-z0-9]{2,5}$/i.test(n)) n += `.${image.type.split('/')[1].replace('jpeg', 'jpg')}`;
  return n;
}

/** Çözülmüş gövde → geçmiş öğesi (uzun metin ya da dosya). */
function describeObject({ name = '', mime = '', data }, base) {
  if (!name && mime === TEXT_MIME) return { ...base, kind: 'text', text: utf8Text(data) };
  const image = sniffImage(data);
  return {
    ...base,
    kind: 'file',
    name: safeName(name, image),
    mime: image?.type ?? 'application/octet-stream',
    size: data.length,
    image: !!image,
    width: image?.width,
    height: image?.height,
    data: toBase64(data),
  };
}

async function receivedText(ev, dir) {
  const base = { dir, profile: ev.profile, encrypted: ev.encrypted, stats: ev.stats, kind: 'text' };
  if (!ev.encrypted) return { ...base, text: utf8Text(ev.bytes) };
  const opened = await unseal(ev.bytes);
  if (opened.locked) return { ...base, locked: opened.locked, sealed: 'text', data: toBase64(ev.bytes) };
  return { ...base, text: utf8Text(opened.bytes) };
}

async function receivedObject(content, ev, dir) {
  const base = { dir, profile: ev.profile, encrypted: ev.encrypted, stats: ev.stats };
  let body = content;
  if (ev.encrypted) {
    const opened = await unseal(content);
    if (opened.locked) return { ...base, kind: 'file', locked: opened.locked, sealed: 'object', data: toBase64(content), size: content.length };
    body = opened.bytes;
  }
  try {
    return describeObject(unpackBody(body), base);
  } catch (err) {
    return { ...base, kind: 'text', locked: `Bozuk içerik: ${err.message}` };
  }
}

async function unseal(bytes) {
  const password = ui.password.value;
  if (!password) return { locked: 'Şifreli içerik; açmak için parolayı girin.' };
  try {
    return { bytes: await decryptBytes(bytes, password) };
  } catch {
    return { locked: 'Şifreli içerik; parola uyuşmuyor.' };
  }
}

function statsText(item) {
  const s = item.stats;
  if (!s) return '';
  const parts = [`SNR ${Math.round(s.snrDb)} dB`];
  parts.push(s.corrected ? `${s.corrected} bayt düzeltildi` : 'hatasız');
  return parts.join(' · ');
}

function fileText(item) {
  const parts = [item.name];
  if (item.size) parts.push(formatBytes(item.size));
  if (item.width) parts.push(`${item.width}×${item.height}`);
  return parts.join(' · ');
}

function downloadItem(item) {
  saveBlob(new Blob([fromBase64(item.data)], { type: item.image ? item.mime : 'application/octet-stream' }), item.name);
}

function showLast(item) {
  ui.last.hidden = false;
  ui.last.classList.toggle('locked', !!item.locked);
  const file = item.kind === 'file' && !item.locked;
  const image = file && item.image && item.data;
  ui.lastImage.hidden = !image;
  if (image) {
    ui.lastImage.src = `data:${item.mime};base64,${item.data}`;
    ui.lastImage.alt = item.name;
  } else ui.lastImage.removeAttribute('src');
  ui.lastText.textContent = item.locked ?? (file ? fileText(item) : item.text);
  ui.lastText.classList.toggle('file-name', !!file);
  ui.lastMeta.textContent = [getProfile(item.profile).name, item.encrypted ? 'şifreli' : '', statsText(item)]
    .filter(Boolean)
    .join(' · ');
  ui.copyLast.hidden = !!item.locked || file;
  ui.copyLast.onclick = () => copyText(item.text, ui.copyLast);
  ui.saveLast.hidden = !file || !item.data;
  ui.saveLast.onclick = () => downloadItem(item);
}

// ---------------------------------------------------------------- geçmiş

function addHistory(item) {
  const entry = { ...item, time: Date.now() };
  if (entry.data && entry.data.length > (HISTORY_DATA_LIMIT * 4) / 3) {
    entry.data = undefined; // çok büyük: yalnız bu oturumda indirilebilir (son mesaj kutusu)
    entry.dropped = true;
  }
  state.history.unshift(entry);
  state.history.length = Math.min(state.history.length, HISTORY_LIMIT);
  saveHistory();
  renderHistory();
}

/** Depolama dolarsa en eski dosyaların verisi atılarak yeniden denenir. */
function saveHistory() {
  while (!saveJson(HISTORY_KEY, state.history)) {
    const i = state.history.findLastIndex((h) => h.kind === 'file' && h.data && !h.locked);
    if (i < 0) return;
    state.history[i] = { ...state.history[i], data: undefined, dropped: true };
  }
}

const DIR_LABEL = { in: 'Alındı', out: 'Gönderildi', file: 'Dosyadan', sim: 'Simülasyon' };

function renderHistory() {
  ui.historyEmpty.hidden = state.history.length > 0;
  ui.history.replaceChildren(
    ...state.history.map((item) => {
      const file = item.kind === 'file' && !item.locked;
      const li = document.createElement('li');
      li.className = `item ${item.dir}${item.locked ? ' locked' : ''}${file ? ' has-file' : ''}`;
      const head = document.createElement('div');
      head.className = 'item-head';
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = DIR_LABEL[item.dir] ?? item.dir;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = [
        new Date(item.time).toLocaleTimeString('tr-TR'),
        getProfile(item.profile).name,
        item.encrypted ? 'şifreli' : '',
        statsText(item),
      ]
        .filter(Boolean)
        .join(' · ');
      head.append(tag, meta);
      const body = document.createElement('div');
      body.className = 'item-text';
      if (file) {
        if (item.image && item.data) {
          const img = document.createElement('img');
          img.className = 'thumb';
          img.alt = item.name;
          img.src = `data:${item.mime};base64,${item.data}`;
          body.append(img);
        }
        const name = document.createElement('span');
        name.textContent = fileText(item) + (item.dropped ? ' · veri saklanmadı (büyük)' : '');
        body.append(name);
      } else {
        body.textContent = item.locked ?? item.text;
      }
      li.append(head, body);
      const action = file ? (item.data ? 'İndir' : null) : item.locked ? null : 'Kopyala';
      if (action) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn small ghost copy';
        btn.textContent = action;
        btn.addEventListener('click', () => (file ? downloadItem(item) : copyText(item.text, btn)));
        head.append(btn);
      }
      return li;
    }),
  );
}

/** Parola değişince kilitli (şifreli) kayıtlar yeniden açılmaya çalışılır. */
async function unlockHistory() {
  let changed = false;
  for (let i = 0; i < state.history.length; i++) {
    const item = state.history[i];
    if (!item.locked || !item.data) continue;
    const sealed = fromBase64(item.data);
    const opened = await unseal(sealed);
    if (opened.locked) continue;
    const base = { dir: item.dir, profile: item.profile, encrypted: true, stats: item.stats, time: item.time };
    if (item.sealed === 'object') {
      try {
        state.history[i] = { ...describeObject(unpackBody(opened.bytes), base), time: item.time };
      } catch {
        continue;
      }
    } else {
      state.history[i] = { ...base, kind: 'text', text: utf8Text(opened.bytes) };
    }
    changed = true;
  }
  if (changed) {
    saveHistory();
    renderHistory();
    if (state.history[0] && !ui.last.hidden) showLast(state.history[0]);
  }
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Kopyalandı';
    setTimeout(() => (btn.textContent = old), 1500);
  } catch {
    warn('Pano erişimi yok; metni elle seçip kopyalayın.');
  }
}

// ---------------------------------------------------------------- uyarılar

function warn(text) {
  const div = document.createElement('div');
  div.className = 'warning';
  const span = document.createElement('span');
  span.textContent = text;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.setAttribute('aria-label', 'Kapat');
  close.textContent = '×';
  close.addEventListener('click', () => {
    div.remove();
    ui.warnings.hidden = !ui.warnings.children.length;
  });
  div.append(span, close);
  ui.warnings.append(div);
  ui.warnings.hidden = false;
}

function checkEnvironment() {
  if (!window.isSecureContext) warn('Sayfa güvenli bağlamda değil (HTTPS/localhost): mikrofon ve şifreleme çalışmaz.');
  if (!('AudioWorkletNode' in window)) warn('Bu tarayıcı AudioWorklet desteklemiyor; dinleme çalışmaz.');
}

// ---------------------------------------------------------------- başlat

function init() {
  const prefs = loadJson(PREFS_KEY, {});
  if (prefs.profile && PROFILES.some((p) => p.key === prefs.profile)) state.profile = prefs.profile;
  state.experimental = prefs.experimental === true;
  if (Number.isFinite(prefs.volume)) ui.volume.value = prefs.volume;
  if (IMAGE_PRESETS.some((q) => q.key === prefs.quality)) state.quality = prefs.quality;
  ui.loop.checked = !!prefs.loop;
  ui.volumeOut.textContent = `%${ui.volume.value}`;
  state.history = loadJson(HISTORY_KEY, []).filter((h) => h && h.profile && PROFILES.some((p) => p.key === h.profile));

  renderPickers();
  renderProfileTable();
  renderHistory();
  setMode(prefs.mode === 'file' ? 'file' : 'text', false);
  checkEnvironment();

  ui.message.addEventListener('input', updateEstimate);
  ui.password.addEventListener('input', updateEstimate);
  ui.password.addEventListener('change', unlockHistory);
  ui.message.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  });
  ui.tabText.addEventListener('click', () => setMode('text'));
  ui.tabFile.addEventListener('click', () => setMode('file'));
  for (const tab of [ui.tabText, ui.tabFile]) {
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const next = tab === ui.tabText ? ui.tabFile : ui.tabText;
      next.click();
      next.focus();
    });
  }
  ui.filePick.addEventListener('change', () => setAttachment(ui.filePick.files[0]));
  ui.cameraPick.addEventListener('change', () => setAttachment(ui.cameraPick.files[0]));
  ui.attachmentClear.addEventListener('click', clearAttachment);
  const card = ui.drop.closest('.card');
  card.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    ui.drop.classList.add('over');
  });
  card.addEventListener('dragleave', (e) => {
    if (!card.contains(e.relatedTarget)) ui.drop.classList.remove('over');
  });
  card.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    ui.drop.classList.remove('over');
    if (!file) return;
    e.preventDefault();
    setAttachment(file);
  });
  document.addEventListener('paste', (e) => {
    const file = [...(e.clipboardData?.files ?? [])][0];
    if (!file) return; // düz metin yapıştırma olduğu gibi kalır
    e.preventDefault();
    setAttachment(file);
  });
  ui.volume.addEventListener('input', () => {
    ui.volumeOut.textContent = `%${ui.volume.value}`;
    savePrefs();
  });
  ui.loop.addEventListener('change', savePrefs);
  ui.experimental.addEventListener('change', () => setExperimental(ui.experimental.checked));
  ui.sendBtn.addEventListener('click', send);
  ui.stopBtn.addEventListener('click', stopPlayback);
  ui.wavBtn.addEventListener('click', downloadWav);
  ui.listenBtn.addEventListener('click', () => (state.listening ? stopListening() : startListening()));
  ui.rangeBtn.addEventListener('click', () => setRange(spectrogram.maxHz > 12000 ? 10000 : 20000));
  ui.fileInput.addEventListener('change', () => ui.fileInput.files[0] && decodeFile(ui.fileInput.files[0]));
  ui.selftestBtn.addEventListener('click', selftest);
  ui.clearHistory.addEventListener('click', () => {
    state.history = [];
    saveHistory();
    renderHistory();
  });
  updateEstimate();
}

init();
