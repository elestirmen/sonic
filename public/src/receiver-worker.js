// Çözme işi ana iş parçacığını (arayüzü) yormasın diye burada yapılır.
//
// Ana → worker:
//   { type: 'start', sampleRate }            canlı dinleme başlat
//   { type: 'samples', data }                canlı ses parçası (Float32Array)
//   { type: 'stop' }
//   { type: 'decode', id, sampleRate, data } dosyadaki sesi çöz
//   { type: 'selftest', id, bytes, profile, encrypted, channel }
// Worker → ana:
//   { type: 'event', event }                 canlı alıcı olayı
//   { type: 'decoded', id, events, ms, seconds }

import { Receiver } from './receiver.js';
import { encodeMessage } from './modem.js';
import { simulateChannel } from './dsp/channel.js';

let live = null;

function decodeBuffer(samples, sampleRate) {
  const events = [];
  const t0 = performance.now();
  const rx = new Receiver(sampleRate, { onEvent: (e) => events.push(e) });
  for (let i = 0; i < samples.length; i += 4096) rx.push(samples.subarray(i, i + 4096));
  rx.flush();
  return { events, ms: performance.now() - t0, seconds: samples.length / sampleRate };
}

self.onmessage = (e) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'start':
        live = new Receiver(m.sampleRate, { onEvent: (event) => self.postMessage({ type: 'event', event }) });
        break;
      case 'samples':
        live?.push(m.data);
        break;
      case 'stop':
        live = null;
        break;
      case 'decode':
        self.postMessage({ type: 'decoded', id: m.id, ...decodeBuffer(m.data, m.sampleRate) });
        break;
      case 'selftest': {
        const fs = 48000;
        const { samples } = encodeMessage(m.bytes, m.profile, fs, { encrypted: m.encrypted });
        const heard = simulateChannel(samples, fs, { ...m.channel, seed: Math.floor(Math.random() * 1e9) });
        self.postMessage({ type: 'decoded', id: m.id, ...decodeBuffer(heard, fs) });
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: err?.message ?? String(err) });
  }
};
