// LDPC(174, 91): FT8'in iç kodu (Mod 7). Yer tutucu; kod ve çözücü Mod 7 ile gelir.

const N = 174;
const K = 91;

export const LDPC = {
  N,
  K,
  rate: K / N,
  codedLength: (k) => Math.ceil(k / K) * N,
  encode() {
    throw new Error('LDPC henüz yok');
  },
  decode() {
    throw new Error('LDPC henüz yok');
  },
};
