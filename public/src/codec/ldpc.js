// LDPC(174, 91): FT8'in iç kodu (Mod 7; Franke, Somerville ve Taylor 2020, QEX Temmuz/Ağustos).
//
// Düzenli, sütun ağırlığı 3 olan düşük yoğunluklu eşlik denetimi kodu (Gallager 1962): 91 bilgi
// bitine 83 eşlik biti eklenir (oran 0,523). Kod sistematiktir: kod sözcüğünün ilk 91 biti bilgi
// bitleridir, ardından üreteç matrisiyle hesaplanan 83 eşlik biti gelir. Her kod biti 3 denetime,
// her denetim 6 ya da 7 bite bağlıdır. Çözücü inanç yayılımıdır (sum-product, "tanh kuralı";
// Johnson, "Iterative Error Correction", 2010): kanal LLR'leri Tanner çizgesinde bit ve denetim
// düğümleri arasında gidip gelir, tüm denetimler tuttuğunda (sendrom sıfır) durur.
//
// FT8'de 91 bit, 77 bitlik mesaj + 14 bitlik CRC'dir. Sonik'te bu CRC yoktur (sapma): paket zaten
// Reed-Solomon dış kod ve CRC-32 taşır (framing.js). Bit akışı sırayla 91 bitlik bloklara bölünür,
// son blok sıfırla tamamlanır. Alıcı tamamlama bitlerini bildiği için onlara çok büyük LLR verir;
// bu, kısaltılmış kodun (shortening) kazancını sağlar (başlıkta 56 bilgi + 35 bilinen bit).
//
// LLR kuralı: log P(bit = 0) / P(bit = 1); pozitif değer 0'a işaret eder (conv.js ile aynı).
//
// Üreteç ve denetim tabloları (kFTX_LDPC_generator, kFTX_LDPC_Nm, kFTX_LDPC_Mn) Kārlis Goba'nın
// ft8_lib kitaplığından (https://github.com/kgoba/ft8_lib, ft8/constants.c) alınmıştır; biçimi
// değiştirildi (onaltılık satırlar, 1 tabanlı indisler korunarak). Özgün lisans:
//
//   MIT License
//
//   Copyright (c) 2018 Kārlis Goba
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.
//
// Tablolar ft8_lib'e göre WSJT-X'in yayımladığı FT8 kodunun kendisidir; burada yalnız veri olarak
// kullanılır. Kodlayıcı ve çözücü bu dosyada baştan yazılmıştır.

const N = 174;
const K = 91;
const M = N - K; // 83 denetim

// ---- ft8_lib (MIT) tabloları başlangıcı
// kFTX_LDPC_generator: 83 satır; her satır 91 bilgi bitiyle çarpılan (mod 2) üreteç satırı, en anlamlı bit önce.
const GENERATOR = [
  '8329ce11bf31eaf509f27fc0', '761c264e25c2593354931320', 'dc265902fb277c6410a1bdc0', '1b3f417858cd2dd33ec7f620',
  '09fda4fee04195fd034783a0', '077cccc11b8873ed5c3d48a0', '29b62afe3ca036f4fe1a9da0', '6054faf5f35d96d3b0c8c3e0',
  'e20798e4310eed27884ae900', '775c9c08e80e26ddae563180', 'b0b811028c2bf997213487c0', '18a0c9231fc60adf5c5ea320',
  '76471e8302a0721e01b12b80', 'ffbccb80ca8341fafb47b2e0', '66a72a158f9325a2bf671700', 'c4243689fe85b1c51363a180',
  '0dff739414d1a1b34b1c2700', '15b48830636c8b99894972e0', '29a89c0d3de81d665489b0e0', '4f126f37fa51cbe61bd6b940',
  '99c47239d0d97d3c84e09400', '1919b75119765621bb4f1e80', '09db12d731faee0b86df6b80', '488fc33df43fbdeea4eafb40',
  '827423ee40b675f756eb5fe0', 'abe197c484cb74757144a9a0', '2b500e4bc0ec5a6d2bdbdd00', 'c474aa53d702187616693600',
  '8eba1a13db3390bd6718cec0', '753844673a27782cc42012e0', '06ff83a145c37035a5c12680', '3b37417858cc2dd33ec3f620',
  '9a4a5a28ee17ca9c324842c0', 'bc29f465309c977e89610a40', '2663ae6ddf8b5ce2bb294880', '46f231efe457034c18144180',
  '3fb2ce85abe9b0c72e06fbe0', 'de87481f282c153971a0a2e0', 'fcd7ccf23c69fa99bba14120', 'f0261447e9490ca8e474cec0',
  '4410115818196f95cdd70120', '088fc31df4bfbde2a4eafb40', 'b8fef1b6307729fb0a078c00', '5afea7acccb77bbc9d99a900',
  '49a7016ac653f65ecdc90760', '1944d085be4e7da8d6cc7d00', '251f62adc4032f0ee7140020', '56471f8702a0721e00b12b80',
  '2b8e4923f2dd51e2d537fa00', '6b550a40a66f4755de95c260', 'a18ad28d4e27fe92a4f6c840', '10c2e586388cb82a3d807580',
  'ef34a41817ee02133db2eb00', '7e9c0c54325a9c15836e0000', '3693e572d1fde4cdf079e860', 'bfb2cec5abe1b0c72e07fbe0',
  '7ee18230c583cccc57d4b080', 'a066cb2fedafc9f526641260', 'bb23725abc47cc5f4cc4cd20', 'ded9dba3bee40c59b5609b40',
  'd9a7016ac653e6decdc90360', '9ad46aed5f707f280ab5fc40', 'e5921c77822587316d7d3c20', '4f14da8242a8b86dca733520',
  '8b8b507ad467d4441df770e0', '22831c9cf1169467ad04b680', '213b838fe2ae54c38ee71800', '5d926b6dd71f085181a4e120',
  '66ab79d4b29ee6e69509e560', '958148682d748a38dd68baa0', 'b8ce020cf069c32a723ab140', 'f4331d6d461607e957527460',
  '6da23ba424b9596133cf9c80', 'a636bcbc7b30c5fbeae67fe0', '5cb0d86a07df654a9089a200', 'f11f106848780fc9ecdd80a0',
  '1fbb5364fb8d2c9d730d5ba0', 'fcb86bc70a50c9d02a5d0340', 'a534433029eac15f322e34c0', 'c989d9c7c3d3b8c55d751300',
  '7bb38b2f0186d46643ae9620', '2644ebadeb44b9467d1f42c0', '608cc857594bfbb55d696000',
];
// kFTX_LDPC_Nm: 83 denetim, her biri bağlı olduğu kod bitlerinin 1 tabanlı indisleri (6 ya da 7 bit).
const NM = [
  [4, 31, 59, 91, 92, 96, 153], [5, 32, 60, 93, 115, 146], [6, 24, 61, 94, 122, 151], [7, 33, 62, 95, 96, 143],
  [8, 25, 63, 83, 93, 96, 148], [6, 32, 64, 97, 126, 138], [5, 34, 65, 78, 98, 107, 154], [9, 35, 66, 99, 139, 146],
  [10, 36, 67, 100, 107, 126], [11, 37, 67, 87, 101, 139, 158], [12, 38, 68, 102, 105, 155],
  [13, 39, 69, 103, 149, 162], [8, 40, 70, 82, 104, 114, 145], [14, 41, 71, 88, 102, 123, 156],
  [15, 42, 59, 106, 123, 159], [1, 33, 72, 106, 107, 157], [16, 43, 73, 108, 141, 160],
  [17, 37, 74, 81, 109, 131, 154], [11, 44, 75, 110, 121, 166], [45, 55, 64, 111, 130, 161, 173],
  [8, 46, 71, 112, 119, 166], [18, 36, 76, 89, 113, 114, 143], [19, 38, 77, 104, 116, 163],
  [20, 47, 70, 92, 138, 165], [2, 48, 74, 113, 128, 160], [21, 45, 78, 83, 117, 121, 151],
  [22, 47, 58, 118, 127, 164], [16, 39, 62, 112, 134, 158], [23, 43, 79, 120, 131, 145],
  [19, 35, 59, 73, 110, 125, 161], [20, 36, 63, 94, 136, 161], [14, 31, 79, 98, 132, 164],
  [3, 44, 80, 124, 127, 169], [19, 46, 81, 117, 135, 167], [7, 49, 58, 90, 100, 105, 168],
  [12, 50, 61, 118, 119, 144], [13, 51, 64, 114, 118, 157], [24, 52, 76, 129, 148, 149],
  [25, 53, 69, 90, 101, 130, 156], [20, 46, 65, 80, 120, 140, 170], [21, 54, 77, 100, 140, 171],
  [35, 82, 133, 142, 171, 174], [14, 30, 83, 113, 125, 170], [4, 29, 68, 120, 134, 173],
  [1, 4, 52, 57, 86, 136, 152], [26, 51, 56, 91, 122, 137, 168], [52, 84, 110, 115, 145, 168],
  [7, 50, 81, 99, 132, 173], [23, 55, 67, 95, 172, 174], [26, 41, 77, 109, 141, 148], [2, 27, 41, 61, 62, 115, 133],
  [27, 40, 56, 124, 125, 126], [18, 49, 55, 124, 141, 167], [6, 33, 85, 108, 116, 156],
  [28, 48, 70, 85, 105, 129, 158], [9, 54, 63, 131, 147, 155], [22, 53, 68, 109, 121, 174], [3, 13, 48, 78, 95, 123],
  [31, 69, 133, 150, 155, 169], [12, 43, 66, 89, 97, 135, 159], [5, 39, 75, 102, 136, 167],
  [2, 54, 86, 101, 135, 164], [15, 56, 87, 108, 119, 171], [10, 44, 82, 91, 111, 144, 149],
  [23, 34, 71, 94, 127, 153], [11, 49, 88, 92, 142, 157], [29, 34, 87, 97, 147, 162],
  [30, 50, 60, 86, 137, 142, 162], [10, 53, 66, 84, 112, 128, 165], [22, 57, 85, 93, 140, 159],
  [28, 32, 72, 103, 132, 166], [28, 29, 84, 88, 117, 143, 150], [1, 26, 45, 80, 128, 147],
  [17, 27, 89, 103, 116, 153], [51, 57, 98, 163, 165, 172], [21, 37, 73, 138, 152, 169], [16, 47, 76, 130, 137, 154],
  [3, 24, 30, 72, 104, 139], [9, 40, 90, 106, 134, 151], [15, 58, 60, 74, 111, 150, 163],
  [18, 42, 79, 144, 146, 152], [25, 38, 65, 99, 122, 160], [17, 42, 75, 129, 170, 172],
];
// kFTX_LDPC_Mn: 174 kod biti, her biri bağlı olduğu 3 denetimin 1 tabanlı indisleri.
const MN = [
  [16, 45, 73], [25, 51, 62], [33, 58, 78], [1, 44, 45], [2, 7, 61], [3, 6, 54], [4, 35, 48], [5, 13, 21],
  [8, 56, 79], [9, 64, 69], [10, 19, 66], [11, 36, 60], [12, 37, 58], [14, 32, 43], [15, 63, 80], [17, 28, 77],
  [18, 74, 83], [22, 53, 81], [23, 30, 34], [24, 31, 40], [26, 41, 76], [27, 57, 70], [29, 49, 65], [3, 38, 78],
  [5, 39, 82], [46, 50, 73], [51, 52, 74], [55, 71, 72], [44, 67, 72], [43, 68, 78], [1, 32, 59], [2, 6, 71],
  [4, 16, 54], [7, 65, 67], [8, 30, 42], [9, 22, 31], [10, 18, 76], [11, 23, 82], [12, 28, 61], [13, 52, 79],
  [14, 50, 51], [15, 81, 83], [17, 29, 60], [19, 33, 64], [20, 26, 73], [21, 34, 40], [24, 27, 77], [25, 55, 58],
  [35, 53, 66], [36, 48, 68], [37, 46, 75], [38, 45, 47], [39, 57, 69], [41, 56, 62], [20, 49, 53], [46, 52, 63],
  [45, 70, 75], [27, 35, 80], [1, 15, 30], [2, 68, 80], [3, 36, 51], [4, 28, 51], [5, 31, 56], [6, 20, 37],
  [7, 40, 82], [8, 60, 69], [9, 10, 49], [11, 44, 57], [12, 39, 59], [13, 24, 55], [14, 21, 65], [16, 71, 78],
  [17, 30, 76], [18, 25, 80], [19, 61, 83], [22, 38, 77], [23, 41, 50], [7, 26, 58], [29, 32, 81], [33, 40, 73],
  [18, 34, 48], [13, 42, 64], [5, 26, 43], [47, 69, 72], [54, 55, 70], [45, 62, 68], [10, 63, 67], [14, 66, 72],
  [22, 60, 74], [35, 39, 79], [1, 46, 64], [1, 24, 66], [2, 5, 70], [3, 31, 65], [4, 49, 58], [1, 4, 5], [6, 60, 67],
  [7, 32, 75], [8, 48, 82], [9, 35, 41], [10, 39, 62], [11, 14, 61], [12, 71, 74], [13, 23, 78], [11, 35, 55],
  [15, 16, 79], [7, 9, 16], [17, 54, 63], [18, 50, 57], [19, 30, 47], [20, 64, 80], [21, 28, 69], [22, 25, 43],
  [13, 22, 37], [2, 47, 51], [23, 54, 74], [26, 34, 72], [27, 36, 37], [21, 36, 63], [29, 40, 44], [19, 26, 57],
  [3, 46, 82], [14, 15, 58], [33, 52, 53], [30, 43, 52], [6, 9, 52], [27, 33, 65], [25, 69, 73], [38, 55, 83],
  [20, 39, 77], [18, 29, 56], [32, 48, 71], [42, 51, 59], [28, 44, 79], [34, 60, 62], [31, 45, 61], [46, 68, 77],
  [6, 24, 76], [8, 10, 78], [40, 41, 70], [17, 50, 53], [42, 66, 68], [4, 22, 72], [36, 64, 81], [13, 29, 47],
  [2, 8, 81], [56, 67, 73], [5, 38, 50], [12, 38, 64], [59, 72, 80], [3, 26, 79], [45, 76, 81], [1, 65, 74],
  [7, 18, 77], [11, 56, 59], [14, 39, 54], [16, 37, 66], [10, 28, 55], [15, 60, 70], [17, 25, 82], [20, 30, 31],
  [12, 67, 68], [23, 75, 80], [27, 32, 62], [24, 69, 75], [19, 21, 71], [34, 53, 61], [35, 46, 47], [33, 59, 76],
  [40, 43, 83], [41, 42, 63], [49, 75, 83], [20, 44, 48], [42, 49, 57],
];
// ---- ft8_lib tabloları sonu

/** parity[i]: i. eşlik bitini oluşturan bilgi bitlerinin indisleri. */
const PARITY = GENERATOR.map((hex) => {
  const idx = [];
  for (let j = 0; j < K; j++) if ((parseInt(hex[j >> 2], 16) >> (3 - (j & 3))) & 1) idx.push(j);
  return idx;
});

// Tanner çizgesi: denetim m'nin kenarları [CHECK_START[m], CHECK_START[m + 1]); EDGE_VAR[e] kenarın biti,
// VAR_EDGES[3n + t] n. bitin t. kenarı.
const CHECK_START = new Int32Array(M + 1);
for (let m = 0; m < M; m++) CHECK_START[m + 1] = CHECK_START[m] + NM[m].length;
const EDGES = CHECK_START[M];
const EDGE_VAR = new Int32Array(EDGES);
const VAR_EDGES = new Int32Array(3 * N);
{
  const fill = new Int32Array(N);
  for (let m = 0; m < M; m++) {
    for (let t = 0; t < NM[m].length; t++) {
      const n = NM[m][t] - 1;
      const e = CHECK_START[m] + t;
      EDGE_VAR[e] = n;
      VAR_EDGES[3 * n + fill[n]++] = e;
    }
  }
}

const MAX_ITER = 40; // ft8_lib'in bp_decode'u gibi; tutan kod sözcüklerinin çoğu 5–15 turda yakınsar
const CLAMP = 25; // |LLR| üst sınırı (tanh doygunluğu)
const KNOWN = 20; // bilinen (tamamlama) bitlerin LLR'si
const CONF_OK = 30; // tüm denetimleri tutan bloğun bayt güveni (dB benzeri)

/** 91 bilgi biti (info[from …]) → 174 bitlik kod sözcüğü (out[at …]). */
function encodeBlock(info, from, count, out, at) {
  for (let j = 0; j < count; j++) out[at + j] = info[from + j];
  for (let i = 0; i < M; i++) {
    let p = 0;
    for (const j of PARITY[i]) if (j < count) p ^= info[from + j];
    out[at + K + i] = p;
  }
}

/** Sert karar dizisinin tutmayan denetim sayısı (unsat verilirse denetim başına 0/1 yazar). */
function syndrome(hard, unsat) {
  let bad = 0;
  for (let m = 0; m < M; m++) {
    let x = 0;
    for (let e = CHECK_START[m]; e < CHECK_START[m + 1]; e++) x ^= hard[EDGE_VAR[e]];
    if (unsat) unsat[m] = x;
    bad += x;
  }
  return bad;
}

/**
 * Tek kod sözcüğünün inanç yayılımı (sum-product). ch: 174 kanal LLR'si.
 * Dönen: { hard: 174 bit, post: son sonsal LLR'ler, errors: tutmayan denetim sayısı, iters }.
 */
export function bpDecode(ch, maxIter = MAX_ITER) {
  const v2c = new Float64Array(EDGES);
  const c2v = new Float64Array(EDGES);
  const t = new Float64Array(EDGES);
  const post = new Float64Array(N);
  const hard = new Uint8Array(N);
  let best = { errors: M + 1 };
  for (let iter = 0; ; iter++) {
    // bit düğümleri: sonsal LLR, sert karar ve denetimlere giden (kendi katkısı çıkarılmış) iletiler
    for (let n = 0; n < N; n++) {
      const a = VAR_EDGES[3 * n];
      const b = VAR_EDGES[3 * n + 1];
      const c = VAR_EDGES[3 * n + 2];
      const total = ch[n] + c2v[a] + c2v[b] + c2v[c];
      post[n] = total;
      hard[n] = total < 0 ? 1 : 0;
      v2c[a] = total - c2v[a];
      v2c[b] = total - c2v[b];
      v2c[c] = total - c2v[c];
    }
    const errors = syndrome(hard);
    if (errors < best.errors) best = { errors, hard: hard.slice(), post: post.slice(), iters: iter };
    if (errors === 0 || iter >= maxIter) break;
    // denetim düğümleri: tanh kuralı, kendisi hariç çarpım (önek/sonek çarpımlarıyla, sıfıra bölmeden)
    for (let e = 0; e < EDGES; e++) {
      const v = v2c[e] > CLAMP ? CLAMP : v2c[e] < -CLAMP ? -CLAMP : v2c[e];
      t[e] = Math.tanh(v / 2);
    }
    for (let m = 0; m < M; m++) {
      const e0 = CHECK_START[m];
      const e1 = CHECK_START[m + 1];
      let prefix = 1;
      for (let e = e0; e < e1; e++) {
        c2v[e] = prefix;
        prefix *= t[e];
      }
      let suffix = 1;
      for (let e = e1 - 1; e >= e0; e--) {
        let p = c2v[e] * suffix;
        suffix *= t[e];
        if (p > 1 - 1e-12) p = 1 - 1e-12;
        else if (p < -1 + 1e-12) p = -1 + 1e-12;
        c2v[e] = 2 * Math.atanh(p);
      }
    }
  }
  return best;
}

/**
 * Bilgi bitlerinin güveni (dB benzeri; yüksek = güvenilir), RS silintileri için. Tüm denetimleri
 * tutan blokta yüksek ve sabit; tutmayan blokta sonsal |LLR| ile azalır, tutmayan denetime bağlı
 * her bit için ayrıca düşer. Tutmayan bloğun bütün baytları WEAK_DB'nin (3) altında kalır.
 */
function blockConfidence(res, out, at, count) {
  if (res.errors === 0) {
    out.fill(CONF_OK, at, at + count);
    return;
  }
  const unsat = new Uint8Array(M);
  syndrome(res.hard, unsat);
  for (let n = 0; n < count; n++) {
    let bad = 0;
    for (let t = 0; t < 3; t++) bad += unsat[MN[n][t] - 1];
    out[at + n] = Math.min(Math.abs(res.post[n]), 20) / 8 - 1.5 * bad;
  }
}

export const LDPC = {
  N,
  K,
  rate: K / N,
  codedLength: (k) => Math.ceil(k / K) * N,

  /** Bit akışı → 91 bitlik bloklar (sonuncusu sıfırla tamamlanır) → 174 bitlik kod sözcükleri. */
  encode(bits) {
    const blocks = Math.ceil(bits.length / K);
    const out = new Uint8Array(blocks * N);
    for (let b = 0; b < blocks; b++) encodeBlock(bits, b * K, Math.min(K, bits.length - b * K), out, b * N);
    return out;
  },

  /** llr: codedLength(k) kanal LLR'si → { bits: k bit, conf: bayt başına güven, blocks: blok sonuçları }. */
  decode(llr, k) {
    const blocks = Math.ceil(k / K);
    const bits = new Uint8Array(k);
    const bitConf = new Float32Array(k);
    const ch = new Float64Array(N);
    const report = [];
    for (let b = 0; b < blocks; b++) {
      const count = Math.min(K, k - b * K);
      for (let n = 0; n < N; n++) ch[n] = n >= count && n < K ? KNOWN : llr[b * N + n] || 0;
      const res = bpDecode(ch);
      for (let n = 0; n < count; n++) bits[b * K + n] = res.hard[n];
      blockConfidence(res, bitConf, b * K, count);
      report.push({ errors: res.errors, iters: res.iters });
    }
    const conf = new Float32Array(k >> 3);
    for (let i = 0; i < conf.length; i++) {
      let c = Infinity;
      for (let j = 0; j < 8; j++) c = Math.min(c, bitConf[8 * i + j]);
      conf[i] = c;
    }
    return { bits, conf, blocks: report };
  },
};

/** Testler için: tablolar (1 tabanlı, ft8_lib biçiminde) ve sendrom. */
export const LDPC_TABLES = { GENERATOR, NM, MN };
export const ldpcErrors = (codeword) => syndrome(codeword);
