import { encodeQr } from './qr.js';
import jsQR from '../vendor/jsqr.js';

self.onmessage = ({ data: m }) => {
  try {
    if (m.type === 'encode') {
      const result = encodeQr(m.bytes);
      self.postMessage({ id: m.id, ...result }, [result.modules.buffer]);
    } else if (m.type === 'scan') {
      const found = jsQR(m.pixels, m.width, m.height, { inversionAttempts: 'dontInvert' });
      const bytes = found ? Uint8Array.from(found.binaryData) : null;
      self.postMessage({ id: m.id, bytes }, bytes ? [bytes.buffer] : []);
    }
  } catch (err) {
    self.postMessage({ id: m.id, error: err.message ?? String(err) });
  }
};
