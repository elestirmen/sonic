// Doğrusal chirp (frekans süpürmesi). Paket başındaki senkron işareti hem
// verici hem de alıcının eşleşmiş süzgeç şablonu aynı fonksiyondan üretilir.

const TAPER = 0.1; // Tukey penceresi: uçlarda %5'lik yumuşak geçiş

export function chirpWaveform({ from, to, dur }, fs, amplitude = 1) {
  const n = Math.round(dur * fs);
  const out = new Float32Array(n);
  const rate = (to - from) / dur;
  const taperN = Math.max(1, Math.round((TAPER / 2) * n));
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const phase = 2 * Math.PI * (from * t + 0.5 * rate * t * t);
    let w = 1;
    if (i < taperN) w = 0.5 - 0.5 * Math.cos((Math.PI * i) / taperN);
    else if (i >= n - taperN) w = 0.5 - 0.5 * Math.cos((Math.PI * (n - 1 - i)) / taperN);
    out[i] = amplitude * w * Math.sin(phase);
  }
  return out;
}
