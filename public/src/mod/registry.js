// Kipleme kaydı. Her yöntem aynı arayüzü sağlar:
//   render(out, start, header, payload, p, fs, amplitude)  birimleri sese yazar (out'a ekler)
//   count(p, headerUnits, payloadUnits)                    sembol sayısı (başvuru/senkron dahil)
//   Demod(p, fs, start)                                    alıcı: windowEnd(j), read(store, j)
// Birim, sert kararlı yöntemlerde (MFSK, DQPSK-OFDM) nibble; iç kodlu yöntemlerde kodlu bittir.
// MFSK'nin çözücüsü alıcının ortak ton okuyucusunu kullanır, bu yüzden receiver.js'te kurulur.

import { mfskSymbolCount, renderMfsk } from './mfsk.js';
import { OfdmDemod, ofdmSymbolCount, renderOfdm } from './ofdm.js';
import { CssDemod, cssSymbolCount, renderCss } from './css.js';
import { DsssDemod, dsssSymbolCount, renderDsss } from './dsss.js';
import { JanusDemod, janusSymbolCount, renderJanus } from './janus.js';
import { QamDemod, qamSymbolCount, renderQam } from './qam.js';
import { Ft8Demod, ft8SymbolCount, renderFt8 } from './ft8.js';
import { DfeDemod, dfeSymbolCount, renderDfe } from './dfe.js';

export const MODS = {
  mfsk: { render: renderMfsk, count: (p, h, n) => mfskSymbolCount(p, n) },
  ofdm: { render: renderOfdm, count: (p, h, n) => ofdmSymbolCount(p, n), Demod: OfdmDemod },
  css: { render: renderCss, count: cssSymbolCount, Demod: CssDemod },
  dsss: { render: renderDsss, count: dsssSymbolCount, Demod: DsssDemod },
  janus: { render: renderJanus, count: janusSymbolCount, Demod: JanusDemod },
  qam: { render: renderQam, count: qamSymbolCount, Demod: QamDemod },
  ft8: { render: renderFt8, count: ft8SymbolCount, Demod: Ft8Demod },
  dfe: { render: renderDfe, count: dfeSymbolCount, Demod: DfeDemod },
};
