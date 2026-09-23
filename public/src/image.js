// Görseller ses hızına göre küçültülür: en uzun kenar ve bayt bütçesi. WebP (aynı
// kalitede JPEG'den belirgin küçük) destekleniyorsa o, yoksa JPEG. Tuvalden yeniden
// kodlandığı için konum gibi EXIF bilgileri de gönderilmez.

export const IMAGE_PRESETS = [
  { key: 'kucuk', name: 'Küçük', maxDim: 160, maxBytes: 2500 },
  { key: 'orta', name: 'Orta', maxDim: 320, maxBytes: 7000 },
  { key: 'buyuk', name: 'Büyük', maxDim: 720, maxBytes: 20000 },
  { key: 'orijinal', name: 'Orijinal', maxDim: 0, maxBytes: 0 },
];

const MAX_PIXELS = 16e6; // alınan görsel bundan büyükse satır içinde açılmaz (bellek bombası)

export async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

let webpOk = null;
async function outputType() {
  if (webpOk === null) {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const b = await toBlob(c, 'image/webp', 0.5);
    webpOk = b?.type === 'image/webp';
  }
  return webpOk ? 'image/webp' : 'image/jpeg';
}

/**
 * Görseli bütçeye sığdırır: önce kaliteyi ikili aramayla düşürür, en düşük kalite de
 * sığmazsa boyutu küçültüp yeniden dener. { bytes, type, width, height } döndürür.
 */
export async function compressImage(img, { maxDim, maxBytes }) {
  const type = await outputType();
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  let scale = Math.min(1, maxDim / Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  let last = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; // JPEG'de saydamlık yok; saydam alanlar siyaha dönmesin
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    let lo = 0.2;
    let hi = 0.85;
    let best = null;
    const top = await toBlob(canvas, type, hi);
    last = top;
    if (top.size <= maxBytes) best = top;
    else {
      for (let i = 0; i < 6; i++) {
        const q = (lo + hi) / 2;
        const b = await toBlob(canvas, type, q);
        last = b;
        if (b.size <= maxBytes) {
          best = b;
          lo = q;
        } else hi = q;
      }
      if (!best) {
        const b = await toBlob(canvas, type, lo);
        last = b;
        if (b.size <= maxBytes) best = b;
      }
    }
    if (best) return { bytes: new Uint8Array(await best.arrayBuffer()), type: best.type, width: canvas.width, height: canvas.height };
    scale *= 0.75;
  }
  return { bytes: new Uint8Array(await last.arrayBuffer()), type: last.type, width: canvas.width, height: canvas.height };
}

/**
 * Alınan baytların gerçekten bilinen bir raster görsel olup olmadığını imzasından
 * anlar (gönderenin bildirdiği türe güvenilmez) ve boyutlarını başlıktan okur.
 * SVG gibi betik taşıyabilen biçimler görsel sayılmaz, dosya olarak indirilir.
 */
export function sniffImage(b) {
  const u32 = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const u16le = (o) => b[o] | (b[o + 1] << 8);
  const u24le = (o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
  const tag = (o, s) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0));
  let info = null;
  if (b.length > 24 && b[0] === 0x89 && tag(1, 'PNG')) info = { type: 'image/png', width: u32(16), height: u32(20) };
  else if (b.length > 10 && tag(0, 'GIF8')) info = { type: 'image/gif', width: u16le(6), height: u16le(8) };
  else if (b.length > 30 && tag(0, 'RIFF') && tag(8, 'WEBP')) {
    if (tag(12, 'VP8 ')) info = { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    else if (tag(12, 'VP8L')) {
      const v = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      info = { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 };
    } else if (tag(12, 'VP8X')) info = { width: u24le(24) + 1, height: u24le(27) + 1 };
    if (info) info.type = 'image/webp';
  } else if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    // JPEG: SOFn işaretçisine kadar bölümleri atla
    let o = 2;
    while (o + 9 < b.length && b[o] === 0xff) {
      const marker = b[o + 1];
      const len = (b[o + 2] << 8) | b[o + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        info = { type: 'image/jpeg', height: (b[o + 5] << 8) | b[o + 6], width: (b[o + 7] << 8) | b[o + 8] };
        break;
      }
      o += 2 + len;
    }
  }
  if (!info || !info.width || !info.height || info.width * info.height > MAX_PIXELS) return null;
  return info;
}
