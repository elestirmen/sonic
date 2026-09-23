// FH-BFSK, JANUS çizgisinde (Mod 5). Yer tutucu: bu yöntemin profili eklenene kadar hiçbir işlev çağrılmaz.

const missing = () => {
  throw new Error('janus: henüz yok');
};

/** Profil bilgisi: { T: sembol süresi (s), lo, hi: kapladığı bant (Hz), codedBitRate: kodlu bit/sn }. */
export const janusInfo = missing;

/** Başlık ve veri kodlu bit sayısından toplam sembol sayısı (başvuru/senkron sembolleri dahil). */
export const janusSymbolCount = missing;

export const renderJanus = missing;

export class JanusDemod {
  constructor() {
    missing();
  }
}
