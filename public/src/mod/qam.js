// pilotlu, koherent OFDM-QAM (Mod 6). Yer tutucu: bu yöntemin profili eklenene kadar hiçbir işlev çağrılmaz.

const missing = () => {
  throw new Error('qam: henüz yok');
};

/** Profil bilgisi: { T: sembol süresi (s), lo, hi: kapladığı bant (Hz), codedBitRate: kodlu bit/sn }. */
export const qamInfo = missing;

/** Başlık ve veri kodlu bit sayısından toplam sembol sayısı (başvuru/senkron sembolleri dahil). */
export const qamSymbolCount = missing;

export const renderQam = missing;

export class QamDemod {
  constructor() {
    missing();
  }
}
