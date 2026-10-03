// Ekran kanalı: QR yayını (gönderen) ve kamerayla okuma (alan). İçerik, parola, sonuç kutusu
// ve geçmiş main.js'te ses kanalıyla ortaktır; bu modül yalnız ekranı ve kamerayı yönetir.

import { VisualAssembler, VisualEncoder, MAX_VISUAL_FILE } from './protocol.js';
import { drawQr } from './qr.js';
import { packBody } from '../transfer.js';
import { encryptBytes } from '../crypto.js';

const NO_QR_MS = 5000; // bu kadar süre Sonik karesi görülmezse yol göster

/**
 * fps(): o anki kare hızı (yayın sürerken değişebilir).
 * onSendChange(): yayın başladı / bitti; ana arayüz düğmeleri ve kilitleri günceller.
 * onSent(object, meta), onReceived(content, meta): geçmiş ve sonuç kutusu için.
 */
export function initVisual({ fps = () => 6, onSendChange = () => {}, onSent = () => {}, onReceived = async () => {} } = {}) {
  const get = (id) => document.getElementById(`visual-${id}`);
  const ui = Object.fromEntries([
    'send-status', 'stage', 'qr', 'round', 'frame-label', 'fullscreen', 'stop',
    'camera', 'status', 'status-text', 'viewfinder', 'video', 'switch',
    'transfer', 'transfer-label', 'count', 'progress', 'transfer-note', 'reset',
  ].map((id) => [id, get(id)]));
  const state = {
    sending: null, sendVersion: 0, sendTimer: 0, expanded: false,
    stream: null, opening: false, cameraVersion: 0, scanTimer: 0, statusTimer: 0,
    devices: [], deviceId: '', lastFrame: 0, hinted: false,
    assembler: new VisualAssembler(), progress: null, otherSeen: false, done: false,
    worker: null, requests: new Map(), nextId: 1, wakeLock: null, wakePending: false,
  };
  const capture = document.createElement('canvas');
  const captureCtx = capture.getContext('2d', { willReadFrequently: true });

  // ---------------------------------------------------------------- Worker

  function disposeWorker(message) {
    const w = state.worker;
    state.worker = null;
    w?.terminate();
    for (const req of state.requests.values()) {
      clearTimeout(req.timer);
      req.reject(new Error(message));
    }
    state.requests.clear();
  }

  function failWorker(message) {
    disposeWorker(message);
    if (state.sending) stopSending(message);
    if (state.stream || state.opening) stopCamera(message, 'fail');
  }

  function worker() {
    if (state.worker) return state.worker;
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = ({ data: m }) => {
      const req = state.requests.get(m.id);
      if (!req) return;
      state.requests.delete(m.id);
      clearTimeout(req.timer);
      if (m.error) req.reject(new Error(m.error));
      else req.resolve(m);
    };
    const fail = (message) => {
      if (state.worker !== w) return;
      failWorker(message);
    };
    w.onerror = (e) => fail(`QR işlemi durdu: ${e.message || 'bilinmeyen hata'}`);
    w.onmessageerror = () => fail('QR çözücüsünün yanıtı okunamadı. Yeniden deneyin.');
    state.worker = w;
    return w;
  }

  function request(message, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = state.nextId++;
      const timer = setTimeout(() => {
        if (state.requests.has(id)) failWorker('QR işlemi zaman aşımına uğradı. Yeniden deneyin.');
      }, 15000);
      state.requests.set(id, { resolve, reject, timer });
      try { worker().postMessage({ ...message, id }, transfer); }
      catch (err) { state.requests.delete(id); clearTimeout(timer); reject(err); }
    });
  }

  async function updateWakeLock() {
    if (!state.sending && !state.stream) {
      const lock = state.wakeLock;
      state.wakeLock = null;
      try { await lock?.release(); } catch { /* tarayıcı zaten bırakmış olabilir */ }
    } else if (!state.wakeLock && !state.wakePending && navigator.wakeLock && document.visibilityState === 'visible') {
      state.wakePending = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (state.sending || state.stream) {
          state.wakeLock = lock;
          lock.addEventListener('release', () => { if (state.wakeLock === lock) state.wakeLock = null; });
        } else await lock.release();
      } catch { /* desteklenmeyen veya düşük pildeki cihazda ekranı kullanıcı açık tutar */ }
      finally { state.wakePending = false; }
    }
  }

  // ---------------------------------------------------------------- QR yayını

  const sendNote = (text) => { ui['send-status'].textContent = text; };

  async function startSending(object, { password = '', blockBytes = 384 } = {}) {
    if (state.sending) return;
    const version = ++state.sendVersion;
    state.sending = { preparing: true };
    onSendChange();
    sendNote('QR yayını hazırlanıyor…');
    try {
      if (object.data.length > MAX_VISUAL_FILE) throw new Error('İçerik en çok 4 MB olabilir.');
      const body = packBody(object);
      const content = password ? await encryptBytes(body, password) : body;
      if (version !== state.sendVersion) return;
      const encoder = new VisualEncoder(content, { blockBytes, encrypted: !!password });
      state.sending = { encoder, seed: 0 };
      onSendChange();
      ui.stage.hidden = false;
      const lock = password ? ' · şifreli' : '';
      sendNote(encoder.k === 1
        ? `Tek QR${lock}. Alıcı okuyunca yayını durdurabilirsin.`
        : `${encoder.k} parça${lock}. Alıcı tamamlandığını gösterince yayını durdur.`);
      updateWakeLock();
      await showFrame(version);
      if (version !== state.sendVersion) return;
      ui.stage.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      onSent(object, { encrypted: !!password });
    } catch (err) {
      if (version === state.sendVersion) stopSending(`Yayın başlatılamadı: ${err.message}`);
    }
  }

  async function showFrame(version) {
    const send = state.sending;
    if (version !== state.sendVersion || !send?.encoder) return;
    const started = performance.now();
    try {
      const { k } = send.encoder;
      const bytes = send.encoder.frame(send.seed);
      const qr = await request({ type: 'encode', bytes }, [bytes.buffer]);
      if (version !== state.sendVersion) return;
      drawQr(ui.qr, qr);
      ui['frame-label'].textContent = k === 1 ? 'Tek QR' : send.seed < k ? `Veri karesi ${send.seed + 1}/${k}` : `İlk tur bitti · kurtarma karesi ${send.seed - k + 1}`;
      ui.round.style.width = `${(100 * Math.min(k, send.seed + 1)) / k}%`;
      send.seed++;
      if (k > 1) state.sendTimer = setTimeout(() => showFrame(version), Math.max(10, 1000 / fps() - (performance.now() - started)));
    } catch (err) {
      if (version === state.sendVersion) stopSending(`Yayın durdu: ${err.message}`);
    }
  }

  function stopSending(message = 'QR yayını durduruldu.') {
    const was = !!state.sending;
    state.sendVersion++;
    clearTimeout(state.sendTimer);
    state.sending = null;
    ui.stage.hidden = true;
    ui.qr.width = ui.qr.height = 0;
    if (document.fullscreenElement === ui.stage) document.exitFullscreen().catch(() => {});
    setExpanded(false);
    if (message !== null) sendNote(message);
    if (was) onSendChange();
    updateWakeLock();
  }

  /** Fullscreen API yoksa (iPhone Safari) QR sayfanın üstünde tam pencere açılır. */
  function setExpanded(on) {
    state.expanded = on;
    ui.stage.classList.toggle('expanded', on);
    document.documentElement.classList.toggle('stage-open', on);
    updateFullscreenLabel();
  }

  function updateFullscreenLabel() {
    const full = state.expanded || document.fullscreenElement === ui.stage;
    ui.fullscreen.textContent = full ? 'Küçült' : 'Tam ekran';
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement === ui.stage) return document.exitFullscreen().catch(() => {});
    if (state.expanded) return setExpanded(false);
    if (ui.stage.requestFullscreen) {
      try { return await ui.stage.requestFullscreen(); } catch { /* aşağıdaki katmana düş */ }
    }
    setExpanded(true);
  }

  // ---------------------------------------------------------------- kamera

  function setStatus(kind, text, revertMs = 0) {
    clearTimeout(state.statusTimer);
    ui.status.dataset.kind = kind;
    ui['status-text'].textContent = text;
    ui.viewfinder.dataset.scan = kind;
    if (revertMs) {
      state.statusTimer = setTimeout(() => {
        if (!state.stream) setStatus('idle', 'Hazır');
        else if (state.progress) setStatus('rx', 'Kalan parçalar bekleniyor…');
        else setStatus('listening', 'QR aranıyor…');
      }, revertMs);
    }
  }

  async function listCameras() {
    try {
      state.devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId);
      state.deviceId = state.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? state.deviceId;
      ui.switch.hidden = state.devices.length < 2;
    } catch { /* aygıt listesi olmadan varsayılan kamera kullanılır */ }
  }

  async function startCamera() {
    if (state.opening || state.stream) return;
    if (!window.isSecureContext) return setStatus('fail', 'Kamera için HTTPS veya localhost gerekir.');
    if (!navigator.mediaDevices?.getUserMedia) return setStatus('fail', 'Bu tarayıcı kameraya erişemiyor.');
    const version = ++state.cameraVersion;
    state.opening = true;
    ui.camera.disabled = true;
    setStatus('idle', 'Kamera açılıyor…');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(state.deviceId ? { deviceId: { exact: state.deviceId } } : { facingMode: { ideal: 'environment' } }),
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (version !== state.cameraVersion) { stream.getTracks().forEach((t) => t.stop()); return; }
      state.stream = stream;
      if (state.done) resetReceive();
      ui.video.srcObject = stream;
      await ui.video.play();
      if (version !== state.cameraVersion) return;
      ui.viewfinder.dataset.state = 'on';
      ui.camera.textContent = 'Kamerayı kapat';
      ui.camera.classList.add('active');
      state.lastFrame = performance.now();
      state.hinted = false;
      setStatus(state.progress ? 'rx' : 'listening', state.progress ? 'Kalan parçalar bekleniyor…' : 'QR aranıyor…');
      updateTransfer();
      for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => {
        if (state.stream === stream) stopCamera('Kamera bağlantısı kesildi. Yeniden açabilirsin.', 'fail');
      });
      ui.viewfinder.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      listCameras();
      updateWakeLock();
      scan(version);
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop());
      if (version === state.cameraVersion) {
        const reason = err.name === 'NotAllowedError' ? 'Kamera izni verilmedi. Tarayıcı izinlerinden kamerayı açıp yeniden dene.'
          : err.name === 'NotFoundError' ? 'Kamera bulunamadı.'
            : err.name === 'OverconstrainedError' ? 'Seçilen kamera açılamadı; varsayılan kamerayla yeniden dene.'
              : `Kamera açılamadı: ${err.message}`;
        if (err.name === 'OverconstrainedError') state.deviceId = '';
        stopCamera(reason, 'fail');
      }
    } finally {
      if (version === state.cameraVersion || !state.stream) { state.opening = false; ui.camera.disabled = false; }
    }
  }

  async function scan(version) {
    if (version !== state.cameraVersion || !state.stream) return;
    try {
      if (ui.video.readyState >= 2 && ui.video.videoWidth) {
        const ratio = Math.min(1, 960 / Math.max(ui.video.videoWidth, ui.video.videoHeight));
        capture.width = Math.max(1, Math.round(ui.video.videoWidth * ratio));
        capture.height = Math.max(1, Math.round(ui.video.videoHeight * ratio));
        captureCtx.drawImage(ui.video, 0, 0, capture.width, capture.height);
        const pixels = captureCtx.getImageData(0, 0, capture.width, capture.height).data;
        const result = await request({ type: 'scan', pixels, width: capture.width, height: capture.height }, [pixels.buffer]);
        if (version !== state.cameraVersion) return;
        if (result.bytes && await onFrame(result.bytes)) return;
        if (!state.hinted && performance.now() - state.lastFrame > NO_QR_MS) {
          state.hinted = true;
          setStatus(state.progress ? 'rx' : 'listening', "QR görünmüyor: yaklaş, QR'nin tamamı çerçevede olsun.");
        }
      }
      state.scanTimer = setTimeout(() => scan(version), 60);
    } catch (err) {
      if (version === state.cameraVersion) stopCamera(`Alım durdu: ${err.message}`, 'fail');
    }
  }

  /** Okunan bir QR. true: içerik tamamlandı, tarama bitti. */
  async function onFrame(bytes) {
    const r = state.assembler.add(bytes);
    if (!r) {
      setStatus(state.progress ? 'rx' : 'listening', 'Bu QR bir Sonik yayını değil.', 2500);
      return false;
    }
    if (r.ignored) {
      state.lastFrame = performance.now();
      state.otherSeen = true;
      updateTransfer();
      setStatus('rx', 'Başka bir QR yayını görüldü.');
      return false;
    }
    state.lastFrame = performance.now();
    state.hinted = false;
    state.progress = r;
    updateTransfer();
    if (!r.content) {
      setStatus('rx', `Alınıyor · %${Math.round((100 * r.have) / r.need)}${r.encrypted ? ' · şifreli' : ''}`);
      return false;
    }
    state.done = true;
    state.progress = null;
    stopCamera(null);
    updateTransfer();
    setStatus('ok', 'Alındı ve doğrulandı');
    await onReceived(r.content, { encrypted: r.encrypted });
    return true;
  }

  function updateTransfer() {
    const p = state.progress;
    ui.transfer.hidden = !p;
    if (!p) return;
    ui.count.textContent = `${p.have}/${p.need} parça`;
    ui.progress.style.width = `${(100 * p.have) / p.need}%`;
    ui['transfer-label'].textContent = `QR yayını alınıyor${p.encrypted ? ' · şifreli' : ''}`;
    ui['transfer-note'].textContent = state.otherSeen
      ? 'Başka bir yayın görüldü; ona geçmek için Sıfırla.'
      : state.stream ? '' : 'Kamera kapalı; alınan parçalar korunuyor.';
  }

  function stopCamera(message = 'Kamera kapalı', kind = 'idle') {
    state.cameraVersion++;
    clearTimeout(state.scanTimer);
    state.stream?.getTracks().forEach((t) => t.stop());
    state.stream = null;
    state.opening = false;
    ui.video.pause();
    ui.video.srcObject = null;
    ui.viewfinder.dataset.state = 'off';
    ui.camera.disabled = false;
    ui.camera.textContent = 'Kamerayı aç';
    ui.camera.classList.remove('active');
    updateTransfer();
    if (message !== null) setStatus(kind, message);
    capture.width = capture.height = 0;
    updateWakeLock();
  }

  function resetReceive() {
    state.assembler = new VisualAssembler();
    state.progress = null;
    state.otherSeen = false;
    state.done = false;
    updateTransfer();
    if (state.stream) setStatus('listening', 'Alım sıfırlandı; yeni QR yayını bekleniyor.');
    else setStatus('idle', 'Hazır');
  }

  function switchCamera() {
    if (state.devices.length < 2) return;
    const i = state.devices.findIndex((d) => d.deviceId === state.deviceId);
    state.deviceId = state.devices[(i + 1) % state.devices.length].deviceId;
    if (state.stream) { stopCamera(null); startCamera(); }
  }

  ui.stop.addEventListener('click', () => stopSending());
  ui.fullscreen.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenLabel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.expanded) setExpanded(false); });
  ui.camera.addEventListener('click', () => (state.stream ? stopCamera() : startCamera()));
  ui.switch.addEventListener('click', switchCamera);
  ui.reset.addEventListener('click', resetReceive);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (state.stream || state.opening) stopCamera('Sayfa arka plana geçti; kamera kapatıldı.');
    if (state.sending) stopSending('Sayfa arka plana geçti; QR yayını durduruldu.');
  });
  window.addEventListener('pagehide', () => {
    stopSending();
    stopCamera();
    disposeWorker('Sayfa kapatıldı.');
  });

  return {
    get sending() { return !!state.sending; },
    get preparing() { return !!state.sending?.preparing; },
    start: startSending,
    stop: () => stopSending(),
    setStatus,
    /** Kanal değişince: yayın ve kamera kapanır, alınan parçalar korunur. */
    stopAll() {
      if (state.sending) stopSending();
      if (state.stream || state.opening) stopCamera();
    },
  };
}
