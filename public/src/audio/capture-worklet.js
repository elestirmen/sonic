// Ses iş parçacığında çalışır: mikrofondan gelen 128'lik çerçeveleri 2048
// örneklik parçalara toplayıp ana iş parçacığına aktarır (kopyalamadan).

const CHUNK = 2048;

class SonikCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(CHUNK);
    this.n = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (channels && channels.length) {
      const x = channels[0]; // çok kanallı mikrofonda yalnız ilk kanal: ortalama tarak etkisi yapabilir
      for (let i = 0; i < x.length; i++) {
        this.buf[this.n++] = x[i];
        if (this.n === CHUNK) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(CHUNK);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('sonik-capture', SonikCapture);
