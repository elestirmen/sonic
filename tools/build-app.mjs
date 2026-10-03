// Mobil uygulamanın web paketini hazırlar: public/ → build/app/ (capacitor.config.json'daki webDir).
//   node tools/build-app.mjs        (npm run app:sync bunu çalıştırıp `cap sync` yapar)
//
// Site public/'ten değişmeden yayınlanır; uygulamaya özgü farklar yalnız kopyaya eklenir:
// - CSP <meta> olarak (sitede nginx başlığı veriyor; Cloudflare sayacı uygulamada yok),
// - viewport-fit=cover + app/app.css (çentik ve ana ekran çubuğu için güvenli alan),
// - app/app.js (konsol kaydı ve gizli kayıt paneli; main.js'ten önce çalışır).

import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}build/app`;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

rmSync(out, { recursive: true, force: true });
cpSync(`${root}public`, out, { recursive: true });
cpSync(`${root}app/app.css`, `${out}/app.css`);
cpSync(`${root}app/app.js`, `${out}/app.js`);

let html = readFileSync(`${out}/index.html`, 'utf8');
// index.html değişip bir çapa kaybolursa sessizce eksik paket üretmek yerine dur.
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`index.html içinde bulunamadı: ${from}`);
  html = html.replace(from, to);
};
swap('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
swap('content="width=device-width, initial-scale=1"', 'content="width=device-width, initial-scale=1, viewport-fit=cover"');
swap(
  '<link rel="stylesheet" href="style.css" />',
  '<link rel="stylesheet" href="style.css" />\n    <link rel="stylesheet" href="app.css" />\n    <script src="app.js"></script>',
);
writeFileSync(`${out}/index.html`, html);

console.log(`Uygulama paketi hazır: ${out}`);
