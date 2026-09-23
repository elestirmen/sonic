// Kodlama ve çözme işi ana iş parçacığını (arayüzü) yormasın diye burada yapılır.
//
// Ana → worker:
//   { type: 'start', sampleRate }            canlı dinleme başlat
//   { type: 'samples', data }                canlı ses parçası (Float32Array)
//   { type: 'stop' }
//   { type: 'encode', id, payloads, profile, sampleRate, kind, encrypted, amplitude }
//   { type: 'decode', id, sampleRate, data } dosyadaki sesi çöz
//   { type: 'selftest', id, payloads, profile, kind, encrypted, channel }
// Worker → ana:
//   { type: 'event', event }                 canlı alıcı olayı
//   { type: 'encoded', id, samples, duration, packets }
//   { type: 'decoded', id, events, ms, seconds }

import { Receiver } from './receiver.js';
import { encodePackets } from './modem.js';
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
      case 'encode': {
        const res = encodePackets(m.payloads, m.profile, m.sampleRate, m);
        self.postMessage({ type: 'encoded', id: m.id, ...res }, [res.samples.buffer]);
        break;
      }
      case 'decode':
        self.postMessage({ type: 'decoded', id: m.id, ...decodeBuffer(m.data, m.sampleRate) });
        break;
      case 'selftest': {
        const fs = 48000;
        const { samples } = encodePackets(m.payloads, m.profile, fs, m);
        const heard = simulateChannel(samples, fs, { ...m.channel, seed: Math.floor(Math.random() * 1e9) });
        self.postMessage({ type: 'decoded', id: m.id, ...decodeBuffer(heard, fs) });
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: err?.message ?? String(err) });
  }
};
