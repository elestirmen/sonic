import { QrCode, QrSegment } from '../vendor/qrcodegen.js';

export function encodeQr(bytes) {
  const qr = QrCode.encodeSegments([QrSegment.makeBytes(bytes)], QrCode.Ecc.MEDIUM, 1, 20, -1, false);
  const modules = new Uint8Array(qr.size * qr.size);
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) modules[y * qr.size + x] = qr.getModule(x, y) ? 1 : 0;
  return { size: qr.size, modules };
}

/** Beyaz sessiz kenar QR'nin parçasıdır; koyu temada da değişmez. */
export function drawQr(canvas, { size, modules }, scale = 6) {
  const border = 4;
  canvas.width = canvas.height = (size + 2 * border) * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (modules[y * size + x]) ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
  }
}
