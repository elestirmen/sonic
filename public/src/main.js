// Arayüz: gönderme, dinleme, dosyadan çözme, simülasyon ve geçmiş.
// Alınan metinler dışarıdan gelen güvenilmez veridir; DOM'a yalnız textContent ile yazılır.

import { PROFILES, getProfile, profileBand, rawByteRate, supportsProfile } from './profiles.js';
import { MAX_MESSAGE_BYTES, encodeMessage, estimateDuration } from './modem.js';
import { decodeWav, encodeWav } from './audio/wav.js';
import { Spectrogram } from './ui/spectrogram.js';
import { ENCRYPTION_OVERHEAD, decryptBytes, encryptBytes } from './crypto.js';

const $ = (id) => document.getElementById(id);
const utf8 = new TextEncoder();
const num = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const HISTORY_KEY = 'sonik.history.v1';
const PREFS_KEY = 'sonik.prefs.v1';
const HISTORY_LIMIT = 60;
const WAV_RATE = 48000;

const ui = {
  message: $('message'),
  byteCount: $('byte-count'),
  estimate: $('duration-estimate'),
  picker: $('profile-picker'),
  summary: $('profile-summary'),
  volume: $('volume'),
  volumeOut: $('volume-out'),
  password: $('password'),
  sendBtn: $('send-btn'),
  wavBtn: $('wav-btn'),
  playback: $('playback'),
  playProgress: $('play-progress'),
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
  last: $('last-message'),
  lastText: $('last-text'),
  lastMeta: $('last-meta'),
  copyLast: $('copy-last'),
  fileInput: $('file-input'),
  selftestBtn: $('selftest-btn'),
  history: $('history'),
  historyEmpty: $('history-empty'),
  clearHistory: $('clear-history'),
  warnings: $('warnings'),
};

const state = {
  profile: 'normal',
  ctx: null,
  analyser: null,
  sink: null,
  workletLoaded: false,
  playing: null,
  listening: null,
  worker: null,
  requests: new Map(),
  nextRequest: 1,
  history: [],
  statusTimer: 0,
  levelBuf: null,
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
  } catch {
    // gizli pencere / kapalı depolama: tercihler bu oturumla sınırlı kalır
  }
}

function savePrefs() {
  saveJson(PREFS_KEY, { profile: state.profile, volume: Number(ui.volume.value) });
}

// ---------------------------------------------------------------- profil ve tahmin

function renderProfiles() {
  ui.picker.replaceChildren(
    ...PROFILES.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.key = p.key;
      b.innerHTML = `<strong></strong><small></small>`;
      b.querySelector('strong').textContent = p.name;
      b.querySelector('small').textContent = `${num.format(rawByteRate(p))} B/sn`;
      b.addEventListener('click', () => selectProfile(p.key));
      return b;
    }),
  );
  selectProfile(state.profile, false);
}

function renderProfileTable() {
  const body = $('profile-table');
  body.replaceChildren(
    ...PROFILES.map((p) => {
      const band = profileBand(p);
      const tr = document.createElement('tr');
      for (const text of [
        p.name,
        `${num.format(rawByteRate(p))} B/sn`,
        `${num.format(band.lo / 1000)}–${num.format(band.hi / 1000)} kHz`,
        p.summary,
      ]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      return tr;
    }),
  );
}

function selectProfile(key, persist = true) {
  state.profile = key;
  const p = getProfile(key);
  for (const b of ui.picker.children) b.setAttribute('aria-checked', String(b.dataset.key === key));
  const band = profileBand(p);
  ui.summary.textContent = `${p.summary} · ${num.format(band.lo / 1000)}–${num.format(band.hi / 1000)} kHz`;
  spectrogram.setMarks([band]);
  if (key === 'ultrasonik' && spectrogram.maxHz < 20000) setRange(20000);
  updateEstimate();
  if (persist) savePrefs();
}

function messageBytes() {
  return utf8.encode(ui.message.value).length + (ui.password.value ? ENCRYPTION_OVERHEAD : 0);
}

function updateEstimate() {
  const n = messageBytes();
  const over = n > MAX_MESSAGE_BYTES;
  ui.byteCount.textContent = String(n);
  ui.byteCount.parentElement.classList.toggle('over', over);
  ui.sendBtn.disabled = n === 0 || over || !!state.playing;
  ui.wavBtn.disabled = n === 0 || over;
  ui.estimate.textContent = n && !over ? `≈ ${num.format(estimateDuration(n, getProfile(state.profile)))} sn` : '';
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

async function preparePayload() {
  let bytes = utf8.encode(ui.message.value);
  const password = ui.password.value;
  if (password) bytes = await encryptBytes(bytes, password);
  return { bytes, encrypted: !!password };
}

async function send() {
  if (state.playing) return;
  const ctx = audio();
  const profile = getProfile(state.profile);
  if (!supportsProfile(profile, ctx.sampleRate)) {
    return warn(`Bu cihazın ses çıkışı (${ctx.sampleRate} Hz) ${profile.name} profilini çalamıyor.`);
  }
  ui.sendBtn.disabled = true;
  try {
    const { bytes, encrypted } = await preparePayload();
    const { samples, duration } = encodeMessage(bytes, profile.key, ctx.sampleRate, { amplitude: 0.9, encrypted });
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = Number(ui.volume.value) / 100;
    source.connect(gain);
    gain.connect(ctx.destination);
    gain.connect(state.analyser);
    setAudioSession(state.listening ? 'play-and-record' : 'playback');
    const start = ctx.currentTime + 0.05;
    source.start(start);
    state.playing = { source, start, duration };
    source.onended = () => {
      state.playing = null;
      ui.playback.hidden = true;
      updateEstimate();
      refreshSpectrogram();
    };
    ui.playback.hidden = false;
    animatePlayback();
    refreshSpectrogram();
    addHistory({ dir: 'out', profile: profile.key, text: ui.message.value, encrypted });
  } catch (err) {
    warn(`Gönderilemedi: ${err.message}`);
    updateEstimate();
  }
}

function animatePlayback() {
  const p = state.playing;
  if (!p) return;
  const t = Math.max(0, state.ctx.currentTime - p.start);
  ui.playProgress.style.width = `${Math.min(100, (100 * t) / p.duration)}%`;
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
  try {
    const { bytes, encrypted } = await preparePayload();
    const { samples } = encodeMessage(bytes, state.profile, WAV_RATE, { amplitude: 0.9, encrypted });
    const url = URL.createObjectURL(new Blob([encodeWav(samples, WAV_RATE)], { type: 'audio/wav' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `sonik-${state.profile}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    warn(`WAV oluşturulamadı: ${err.message}`);
  }
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
      setStatus('rx', `Sinyal yakalandı · ${p.name} · ${ev.length} bayt${ev.encrypted ? ' · şifreli' : ''}`);
      ui.rxBar.hidden = false;
      ui.rxProgress.style.width = '0%';
      break;
    case 'progress':
      ui.rxProgress.style.width = `${(100 * ev.done) / ev.total}%`;
      ui.statusText.textContent = `Çözülüyor · ${p.name} · %${Math.round((100 * ev.done) / ev.total)}`;
      break;
    case 'message': {
      ui.rxBar.hidden = true;
      const item = await receivedItem(ev, 'in');
      showLast(item);
      addHistory(item);
      setStatus('ok', item.locked ? 'Şifreli mesaj alındı' : 'Mesaj alındı', 5000);
      break;
    }
    case 'fail':
      ui.rxBar.hidden = true;
      setStatus('fail', 'Çözülemedi: sinyal zayıf ya da bozuk. Sesi açın ya da yaklaşın.', 6000);
      break;
  }
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

async function selftest() {
  ui.selftestBtn.disabled = true;
  setStatus('rx', 'Simülasyon: yankılı oda + gürültü…');
  try {
    const profile = getProfile(state.profile);
    const band = profileBand(profile);
    const { bytes, encrypted } = await preparePayload();
    const res = await request({
      type: 'selftest',
      bytes,
      profile: profile.key,
      encrypted,
      channel: {
        rt60: 0.45,
        drr: 0,
        snr: 10,
        noiseBand: [band.lo * 0.5, Math.min(23000, band.hi * 1.5)],
        lowCut: 250,
        delay: 0.3,
      },
    });
    await reportBatch(res, 'sim', 'simülasyon');
  } catch (err) {
    setStatus('fail', `Simülasyon hatası: ${err.message}`, 6000);
  } finally {
    ui.selftestBtn.disabled = false;
  }
}

async function reportBatch(res, dir, label) {
  const found = res.events.filter((e) => e.type === 'message');
  const failed = res.events.filter((e) => e.type === 'fail').length;
  for (const ev of found) {
    const item = await receivedItem(ev, dir);
    addHistory(item);
    showLast(item);
  }
  const speed = res.seconds / (res.ms / 1000);
  const summary = found.length
    ? `${label}: ${found.length} mesaj çözüldü (${num.format(res.seconds)} sn ses, ${Math.round(speed)}× gerçek zaman)`
    : `${label}: mesaj bulunamadı${failed ? ` (${failed} paket bozuk)` : ''}`;
  setStatus(found.length ? 'ok' : 'fail', summary, 7000);
}

// ---------------------------------------------------------------- mesaj ve geçmiş

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const utf8Text = (bytes) => new TextDecoder('utf-8', { fatal: false }).decode(bytes);

async function openPayload(bytes, encrypted) {
  if (!encrypted) return { text: utf8Text(bytes) };
  const password = ui.password.value;
  if (!password) return { locked: 'Şifreli mesaj; açmak için parolayı girin.' };
  try {
    return { text: utf8Text(await decryptBytes(bytes, password)) };
  } catch {
    return { locked: 'Şifreli mesaj; parola uyuşmuyor.' };
  }
}

async function receivedItem(ev, dir) {
  const opened = await openPayload(ev.bytes, ev.encrypted);
  return {
    dir,
    profile: ev.profile,
    encrypted: ev.encrypted,
    stats: ev.stats,
    ...opened,
    data: opened.locked ? toBase64(ev.bytes) : undefined,
  };
}

function statsText(item) {
  const s = item.stats;
  if (!s) return '';
  const parts = [`SNR ${Math.round(s.snrDb)} dB`];
  parts.push(s.corrected ? `${s.corrected} bayt düzeltildi` : 'hatasız');
  return parts.join(' · ');
}

function showLast(item) {
  ui.last.hidden = false;
  ui.last.classList.toggle('locked', !!item.locked);
  ui.lastText.textContent = item.locked ?? item.text;
  ui.lastMeta.textContent = [getProfile(item.profile).name, item.encrypted ? 'şifreli' : '', statsText(item)]
    .filter(Boolean)
    .join(' · ');
  ui.copyLast.hidden = !!item.locked;
  ui.copyLast.onclick = () => copyText(item.text, ui.copyLast);
}

function addHistory(item) {
  state.history.unshift({ ...item, time: Date.now() });
  state.history.length = Math.min(state.history.length, HISTORY_LIMIT);
  saveJson(HISTORY_KEY, state.history);
  renderHistory();
}

const DIR_LABEL = { in: 'Alındı', out: 'Gönderildi', file: 'Dosyadan', sim: 'Simülasyon' };

function renderHistory() {
  ui.historyEmpty.hidden = state.history.length > 0;
  ui.history.replaceChildren(
    ...state.history.map((item) => {
      const li = document.createElement('li');
      li.className = `item ${item.dir}${item.locked ? ' locked' : ''}`;
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
      body.textContent = item.locked ?? item.text;
      li.append(head, body);
      if (!item.locked) {
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'btn small ghost copy';
        copy.textContent = 'Kopyala';
        copy.addEventListener('click', () => copyText(item.text, copy));
        head.append(copy);
      }
      return li;
    }),
  );
}

/** Parola değişince kilitli (şifreli) kayıtlar yeniden açılmaya çalışılır. */
async function unlockHistory() {
  let changed = false;
  for (const item of state.history) {
    if (!item.locked || !item.data) continue;
    const opened = await openPayload(fromBase64(item.data), true);
    if (!opened.locked) {
      Object.assign(item, { text: opened.text, locked: undefined, data: undefined });
      changed = true;
    }
  }
  if (changed) {
    saveJson(HISTORY_KEY, state.history);
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
  if (Number.isFinite(prefs.volume)) ui.volume.value = prefs.volume;
  ui.volumeOut.textContent = `%${ui.volume.value}`;
  state.history = loadJson(HISTORY_KEY, []).filter((h) => h && h.profile && PROFILES.some((p) => p.key === h.profile));

  renderProfiles();
  renderProfileTable();
  renderHistory();
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
  ui.volume.addEventListener('input', () => {
    ui.volumeOut.textContent = `%${ui.volume.value}`;
    savePrefs();
  });
  ui.sendBtn.addEventListener('click', send);
  ui.stopBtn.addEventListener('click', stopPlayback);
  ui.wavBtn.addEventListener('click', downloadWav);
  ui.listenBtn.addEventListener('click', () => (state.listening ? stopListening() : startListening()));
  ui.rangeBtn.addEventListener('click', () => setRange(spectrogram.maxHz > 12000 ? 10000 : 20000));
  ui.fileInput.addEventListener('change', () => ui.fileInput.files[0] && decodeFile(ui.fileInput.files[0]));
  ui.selftestBtn.addEventListener('click', selftest);
  ui.clearHistory.addEventListener('click', () => {
    state.history = [];
    saveJson(HISTORY_KEY, state.history);
    renderHistory();
  });
  updateEstimate();
}

init();
