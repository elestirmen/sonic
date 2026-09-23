// Mutlak örnek indeksiyle adreslenen halka tampon. Gelen ses parça parça
// eklenir; senkron dedektörü ve çözücüler geçmişe dönük pencere okur.

export class SampleStore {
  constructor(capacity) {
    this.cap = capacity;
    this.buf = new Float32Array(capacity);
    this.end = 0; // bir sonraki örneğin mutlak indeksi
  }

  get start() {
    return Math.max(0, this.end - this.cap);
  }

  push(samples) {
    let p = this.end % this.cap;
    for (let i = 0; i < samples.length; i++) {
      this.buf[p] = samples[i];
      if (++p === this.cap) p = 0;
    }
    this.end += samples.length;
  }

  /** [from, from + out.length) aralığını out'a kopyalar; bölge silinmişse false. */
  read(from, out) {
    if (from < this.start || from + out.length > this.end) return false;
    let p = from % this.cap;
    for (let i = 0; i < out.length; i++) {
      out[i] = this.buf[p];
      if (++p === this.cap) p = 0;
    }
    return true;
  }
}
