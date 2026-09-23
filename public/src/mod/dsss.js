// DSSS-DBPSK + RAKE (Mod 4). Yer tutucu: bu yöntemin profili eklenene kadar hiçbir işlev çağrılmaz.

const missing = () => {
  throw new Error('dsss: henüz yok');
};

/** Profil bilgisi: { T: sembol süresi (s), lo, hi: kapladığı bant (Hz), codedBitRate: kodlu bit/sn }. */
export const dsssInfo = missing;

/** Başlık ve veri kodlu bit sayısından toplam sembol sayısı (başvuru/senkron sembolleri dahil). */
export const dsssSymbolCount = missing;

export const renderDsss = missing;

export class DsssDemod {
  constructor() {
    missing();
  }
}
