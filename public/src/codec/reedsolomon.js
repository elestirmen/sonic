// GF(2^8) üzerinde Reed-Solomon kodu (sistematik, kısaltılmış bloklar destekli).
// İlkel polinom x^8 + x^4 + x^3 + x^2 + 1 (0x11d), üreteç α = 2, ilk kök α^0.
// nsym parite baytı ile: 2·hata + silinti ≤ nsym olduğu sürece düzeltir.
// Algoritma: sendromlar → Forney sendromları → Berlekamp-Massey → Chien → Forney.
// Polinomlar dizi olarak, en yüksek dereceli katsayı başta tutulur.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
const div = (a, b) => (a === 0 ? 0 : EXP[(LOG[a] + 255 - LOG[b]) % 255]);
const inv = (a) => EXP[255 - LOG[a]];
const alphaPow = (n) => EXP[((n % 255) + 255) % 255];

export class RSError extends Error {}

function polyScale(p, x) {
  return p.map((c) => mul(c, x));
}

function polyAdd(p, q) {
  const r = new Array(Math.max(p.length, q.length)).fill(0);
  for (let i = 0; i < p.length; i++) r[i + r.length - p.length] = p[i];
  for (let i = 0; i < q.length; i++) r[i + r.length - q.length] ^= q[i];
  return r;
}

function polyMul(p, q) {
  const r = new Array(p.length + q.length - 1).fill(0);
  for (let j = 0; j < q.length; j++) {
    if (q[j] === 0) continue;
    for (let i = 0; i < p.length; i++) r[i + j] ^= mul(p[i], q[j]);
  }
  return r;
}

function polyEval(p, x) {
  let y = p[0];
  for (let i = 1; i < p.length; i++) y = mul(y, x) ^ p[i];
  return y;
}

const generators = new Map();
function generator(nsym) {
  let g = generators.get(nsym);
  if (!g) {
    g = [1];
    for (let i = 0; i < nsym; i++) g = polyMul(g, [1, alphaPow(i)]);
    generators.set(nsym, g);
  }
  return g;
}

/** data + nsym parite baytı döndürür. */
export function rsEncode(data, nsym) {
  if (data.length + nsym > 255) throw new RangeError('RS bloğu 255 baytı aşamaz');
  const gen = generator(nsym);
  const out = new Uint8Array(data.length + nsym);
  out.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = out[i];
    if (coef === 0) continue;
    for (let j = 1; j < gen.length; j++) out[i + j] ^= mul(gen[j], coef);
  }
  out.set(data); // bölme veri kısmını bozdu; kalan (parite) sonda duruyor
  return out;
}

function syndromes(msg, nsym) {
  // Başa bir 0 eklenir; aşağıdaki formüller bu kaydırmayı varsayar.
  const s = new Array(nsym + 1).fill(0);
  for (let i = 0; i < nsym; i++) s[i + 1] = polyEval(msg, alphaPow(i));
  return s;
}

function forneySyndromes(synd, erasePos, n) {
  const f = synd.slice(1);
  for (const p of erasePos) {
    const x = alphaPow(n - 1 - p);
    for (let j = 0; j < f.length - 1; j++) f[j] = mul(f[j], x) ^ f[j + 1];
  }
  return f;
}

function errorLocator(synd, nsym, eraseCount) {
  let loc = [1];
  let old = [1];
  const shift = synd.length > nsym ? synd.length - nsym : 0;
  for (let i = 0; i < nsym - eraseCount; i++) {
    const k = i + shift;
    let delta = synd[k];
    for (let j = 1; j < loc.length; j++) delta ^= mul(loc[loc.length - 1 - j], synd[k - j]);
    old = [...old, 0];
    if (delta !== 0) {
      if (old.length > loc.length) {
        const next = polyScale(old, delta);
        old = polyScale(loc, inv(delta));
        loc = next;
      }
      loc = polyAdd(loc, polyScale(old, delta));
    }
  }
  while (loc.length && loc[0] === 0) loc.shift();
  if (2 * (loc.length - 1) + eraseCount > nsym) throw new RSError('düzeltilemeyecek kadar çok hata');
  return loc;
}

function chienSearch(locReversed, n) {
  const pos = [];
  for (let i = 0; i < n; i++) if (polyEval(locReversed, alphaPow(i)) === 0) pos.push(n - 1 - i);
  if (pos.length !== locReversed.length - 1) throw new RSError('hata konumları bulunamadı');
  return pos;
}

function correctErrata(msg, synd, errPos) {
  const coefPos = errPos.map((p) => msg.length - 1 - p);
  let loc = [1];
  for (const c of coefPos) loc = polyMul(loc, polyAdd([1], [alphaPow(c), 0]));
  // Ω(x) = S(x)·Λ(x) mod x^(ν+1)
  const prod = polyMul([...synd].reverse(), loc);
  const omega = prod.slice(prod.length - loc.length);
  const X = coefPos.map((c) => alphaPow(c));
  const out = msg.slice();
  for (let i = 0; i < X.length; i++) {
    const xiInv = inv(X[i]);
    let locPrime = 1;
    for (let j = 0; j < X.length; j++) if (j !== i) locPrime = mul(locPrime, 1 ^ mul(xiInv, X[j]));
    if (locPrime === 0) throw new RSError('hata büyüklüğü bulunamadı');
    const y = mul(X[i], polyEval(omega, xiInv));
    out[errPos[i]] ^= div(y, locPrime);
  }
  return out;
}

/**
 * Kod sözcüğünü çözer. erasePos: yeri bilinen şüpheli bayt indeksleri.
 * Başarıda { data, corrected, errors, erasures }; aksi hâlde RSError fırlatır.
 */
export function rsDecode(codeword, nsym, erasePos = []) {
  const n = codeword.length;
  if (n > 255 || n <= nsym) throw new RangeError('geçersiz RS blok uzunluğu');
  const erasures = [...new Set(erasePos)];
  if (erasures.length > nsym) throw new RSError('çok fazla silinti');
  const msg = Array.from(codeword);
  for (const p of erasures) msg[p] = 0;

  let synd = syndromes(msg, nsym);
  let fixed = msg;
  let errors = 0;
  if (synd.some((v) => v !== 0)) {
    const fsynd = forneySyndromes(synd, erasures, n);
    const loc = errorLocator(fsynd, nsym, erasures.length);
    const errPos = chienSearch([...loc].reverse(), n);
    errors = errPos.length;
    fixed = correctErrata(msg, synd, [...erasures, ...errPos]);
    synd = syndromes(fixed, nsym);
    if (synd.some((v) => v !== 0)) throw new RSError('düzeltme doğrulanamadı');
  }
  let corrected = 0;
  for (let i = 0; i < n; i++) if (fixed[i] !== codeword[i]) corrected++;
  return { data: Uint8Array.from(fixed.slice(0, n - nsym)), corrected, errors, erasures: erasures.length };
}
