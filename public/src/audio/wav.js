// WAV okuma/yazma (tarayıcı ve Node ortak). Yazma: 16-bit PCM mono.
// Okuma: 8/16/24/32-bit tamsayı ve 32-bit kayan nokta PCM; kanallar ortalanır.

export function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const text = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export function decodeWav(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('WAV dosyası değil');
  let fmt = null;
  let o = 12;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      fmt = {
        format: v.getUint16(body, true),
        channels: v.getUint16(body + 2, true),
        sampleRate: v.getUint32(body + 4, true),
        bits: v.getUint16(body + 14, true),
      };
      if (fmt.format === 0xfffe && size >= 26) fmt.format = v.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV: fmt bölümü eksik');
      const dataLen = Math.min(size, bytes.length - body);
      return { sampleRate: fmt.sampleRate, samples: readPcm(v, body, dataLen, fmt) };
    }
    o = body + size + (size & 1);
  }
  throw new Error('WAV: data bölümü bulunamadı');
}

function readPcm(v, start, len, { format, channels, bits }) {
  const bps = bits / 8;
  const frames = Math.floor(len / (bps * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const o = start + (i * channels + c) * bps;
      let s;
      if (format === 3 && bits === 32) s = v.getFloat32(o, true);
      else if (bits === 16) s = v.getInt16(o, true) / 32768;
      else if (bits === 24) s = ((v.getUint8(o + 2) << 24) | (v.getUint8(o + 1) << 16) | (v.getUint8(o) << 8)) / 2147483648;
      else if (bits === 32) s = v.getInt32(o, true) / 2147483648;
      else if (bits === 8) s = (v.getUint8(o) - 128) / 128;
      else throw new Error(`WAV: desteklenmeyen biçim (${bits} bit)`);
      sum += s;
    }
    out[i] = sum / channels;
  }
  return out;
}
