import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as profiles from '../public/src/profiles.js';
import * as modem from '../public/src/modem.js';
import * as framing from '../public/src/codec/framing.js';
import * as transfer from '../public/src/transfer.js';
import * as image from '../public/src/image.js';
import * as wav from '../public/src/audio/wav.js';
import * as crypt from '../public/src/crypto.js';

// Node'da DOM ve Worker yok. Gerçek arayüz işlevlerini küçük tarayıcı taklitleriyle
// çalıştır; modem, çerçeve, aktarım ve şifreleme modülleri gerçek kodu kullanır.
const mainUrl = new URL('../public/src/main.js', import.meta.url);
const source = readFileSync(mainUrl, 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replaceAll('import.meta.url', JSON.stringify(mainUrl.href))
  .replace(/\ninit\(\);\s*$/, '\n');

function app() {
  const elements = new Map();
  class Element {
    constructor() {
      Object.assign(this, { value: '', checked: false, hidden: true, children: [], style: {}, dataset: {} });
      this.classList = { toggle() {}, add() {}, remove() {} };
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    removeAttribute() {}
    addEventListener() {}
  }
  class Worker {
    constructor() {
      if (Worker.constructorError) throw Worker.constructorError;
      this.messages = [];
      this.terminated = false;
    }
    postMessage(message) {
      if (this.postError) throw this.postError;
      this.messages.push(message);
    }
    terminate() { this.terminated = true; }
  }
  const context = vm.createContext({
    ...profiles, ...modem, ...framing, ...transfer, ...image, ...wav, ...crypt,
    TextEncoder, TextDecoder, Uint8Array, Uint16Array, Float32Array, Blob, URL, crypto, btoa, atob, Worker,
    setTimeout() {}, clearTimeout() {}, requestAnimationFrame() {},
    localStorage: { setItem() {}, getItem() { return null; } },
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
      },
      createElement() { return new Element(); },
    },
    Spectrogram: class { start() {} stop() {} },
  });
  vm.runInContext(source, context, { filename: mainUrl.pathname });
  vm.runInContext("audio = () => ({ sampleRate: 48000 }); play = () => {}; renderHistory = () => {};", context);
  const api = vm.runInContext('({ state, ui, currentPlan, send, downloadWav, selftest, request, worker })', context);
  api.ui.message.value = 'Merhaba';
  return { ...api, Worker, context };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('Arayüz: doğrudan gönderme çağrısı da beş dakikalık sınırı uygular', async () => {
  const a = app();
  a.ui.message.value = 'A'.repeat(5000);
  assert.equal(a.currentPlan().tooLong, true);
  await a.send();
  assert.equal(a.state.worker, null);
  assert.equal(a.state.busy, false);
  assert.match(a.ui.warnings.children[0].children[0].textContent, /en çok 5 dakika/);
});

test('Arayüz: boş mesaj Worker işi oluşturmaz', async () => {
  const a = app();
  a.ui.message.value = '';
  await a.send();
  assert.equal(a.state.worker, null);
});

for (const method of ['send', 'downloadWav', 'selftest']) {
  test(`Arayüz: Worker hatasında ${method} biter ve düğmeler açılır`, async () => {
    const a = app();
    const pending = a[method]();
    await tick();
    const w = a.state.worker;
    assert.equal(a.state.busy, true);
    assert.equal(a.state.requests.size, 1);
    w.onerror({ message: 'modül yüklenemedi' });
    await pending;
    assert.equal(w.terminated, true);
    assert.equal(a.state.worker, null);
    assert.equal(a.state.requests.size, 0);
    assert.equal(a.state.busy, false);
    assert.equal(a.ui.sendBtn.disabled, false);
    assert.equal(a.ui.wavBtn.disabled, false);
    assert.equal(a.ui.selftestBtn.disabled, false);
  });
}

test('Arayüz: bütün bekleyen istekler reddedilir; yeni Worker ile yeniden denenebilir', async () => {
  const a = app();
  const pending = Promise.allSettled([a.request({ type: 'decode' }), a.request({ type: 'encode' })]);
  const old = a.state.worker;
  old.onerror({ message: 'çözücü hatası' });
  assert.ok((await pending).every((r) => r.status === 'rejected'));
  const retry = a.request({ type: 'encode' });
  const fresh = a.state.worker;
  assert.notEqual(fresh, old);
  old.onerror({ message: 'eski Worker olayı' });
  assert.equal(a.state.worker, fresh);
  assert.equal(a.state.requests.size, 1);
  fresh.onmessage({ data: { type: 'encoded', id: fresh.messages[0].id, duration: 1 } });
  assert.equal((await retry).duration, 1);
  assert.equal(a.state.requests.size, 0);
});

test('Arayüz: Worker oluşturma ve mesaj gönderme hataları istek biriktirmez', async () => {
  const a = app();
  a.Worker.constructorError = new Error('Worker oluşturulamadı');
  await assert.rejects(a.request({ type: 'encode' }), /oluşturulamadı/);
  assert.equal(a.state.requests.size, 0);
  a.Worker.constructorError = null;
  a.worker().postError = new Error('mesaj gönderilemedi');
  await assert.rejects(a.request({ type: 'encode' }), /gönderilemedi/);
  assert.equal(a.state.requests.size, 0);
});

test('Arayüz: okunamayan Worker yanıtı bekleyen işlemi reddeder', async () => {
  const a = app();
  const pending = a.request({ type: 'decode' });
  const rejected = assert.rejects(pending, /yanıtı okunamadı/);
  a.state.worker.onmessageerror();
  await rejected;
  assert.equal(a.state.requests.size, 0);
  assert.equal(a.state.worker, null);
});

test('Arayüz: Worker hatasında canlı dinleme ve mikrofon durdurulur', () => {
  const a = app();
  let stopped = 0;
  let disconnected = 0;
  const port = { onmessage() {} };
  a.state.listening = {
    node: { port, disconnect() { disconnected++; } },
    source: { disconnect() { disconnected++; } },
    stream: { getTracks: () => [{ stop() { stopped++; } }] },
  };
  a.worker().onerror({ message: 'canlı çözücü hatası' });
  assert.equal(stopped, 1);
  assert.equal(disconnected, 2);
  assert.equal(port.onmessage, null);
  assert.equal(a.state.listening, null);
  assert.equal(a.ui.listenBtn.textContent, 'Dinlemeyi başlat');
});
