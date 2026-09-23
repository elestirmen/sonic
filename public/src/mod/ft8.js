// FT8 tipi 8-GFSK + LDPC (Mod 7). Yer tutucu: bu yöntemin profili eklenene kadar hiçbir işlev çağrılmaz.

const missing = () => {
  throw new Error('ft8: henüz yok');
};

/** Profil bilgisi: { T: sembol süresi (s), lo, hi: kapladığı bant (Hz), codedBitRate: kodlu bit/sn }. */
export const ft8Info = missing;

/** Başlık ve veri kodlu bit sayısından toplam sembol sayısı (başvuru/senkron sembolleri dahil). */
export const ft8SymbolCount = missing;

export const renderFt8 = missing;

export class Ft8Demod {
  constructor() {
    missing();
  }
}
