# Sonik: sesle veri aktarımı

Tarayıcıda çalışan, bağımlılıksız bir **akustik modem**. Bir cihaz metni, görseli ya da dosyayı
sese çevirip çalar, diğeri mikrofonla dinleyip çözer. Kurulum, sunucu ya da hesap yok: ses de
içerik de hiçbir yere gönderilmez, her şey tarayıcıda işlenir.

Sekiz ayrı yöntem (mod) sunar; her biri literatürde yerleşik bir kiplemeden gelir. Varsayılan yöntem
**MFSK**'dir (frekans atlamalı ton kümeleri). Diğer yedisi deneyseldir. Altısı üç kipleme ailesini
evreli/evresiz çiftler hâlinde tamamlar: yayılı spektrumda **CSS** (LoRa tipi chirp) ve **DSSS**
(doğrudan dizili, RAKE alıcı); frekans kaydırmada **JANUS** (NATO'nun frekans atlamalı ikili FSK'si)
ve **FT8** (8-GFSK, LDPC); çok taşıyıcıda **DQPSK-OFDM** (diferansiyel) ve **OFDM-QAM** (pilotlu,
koherent). Yedincisi tek taşıyıcıdır: **SC-DFE** (koherent PSK ve uyarlamalı karar geri beslemeli
eşitleyici; su altı akustiğinde yüksek hızın klasik yolu). Hepsi aynı senkron, çerçeve ve Reed-Solomon katmanını paylaşır; böylece aynı kanal
simülatöründe yan yana karşılaştırılabilirler. Alıcı hangi yöntemin geldiğini kendisi tanır.

**Canlı sürüm:** <https://sonik.perinet.org>

![Sonik arayüzü: yedi yöntem, bant ve hız seçimi; görsel OFDM-QAM Turbo ile simülasyonda gönderilip çözülmüş](docs/sonik.webp)

## Özellikler

- **8 yöntem, 38 profil:** 3 frekans bandı (Standart 2–10 kHz, Yüksek 11–17 kHz, Ultrasonik
  17–20,5 kHz) ve hız kademeleri; net 2,8 B/sn'den 1,3 KB/sn'ye. Mod 1 varsayılan, Mod 2–8 deneysel.
- **Metin, görsel ve dosya:** görsel seçilen boyuta küçültülüp WebP olarak yeniden kodlanır; her
  tür dosya gönderilebilir (yayın en çok 5 dakika: Turbo ile ~80 KB). Uzun metin kendiliğinden parçalanır.
- **Canlı görsel önizleme:** alıcıda görsel, bitmesi beklenmeden parçalar geldikçe yukarıdan aşağı
  çizilir; WebP'den vazgeçmeden (bkz. Ortak katmanlar).
- **Sağlamlık:** Reed-Solomon (silintili), CRC-32; deneysel yöntemlerin çoğunda ayrıca bir iç kod
  (K = 7 ya da K = 9 evrişimli kod ve yumuşak kararlı Viterbi; FT8'de LDPC ve inanç yayılımı);
  paketler arası eşlik parçaları ve tekrar kipi (kaçan parçalar sonraki turda tamamlanır).
- **Otomatik uyum:** profil paket başındaki chirp'ten ve başlıktan tanınır; 44,1/48 kHz farkı, saat
  kayması, cihaz hareketi (Doppler) ve oda yankısı hesaba katılır.
- **İsteğe bağlı şifreleme:** PBKDF2-SHA256 → AES-256-GCM.
- **Araçlar:** canlı spektrogram, WAV indirme, ses kaydından çözme, tarayıcı içinde oda simülasyonu,
  komut satırı kodlayıcı/çözücü ve kanal koşullarına göre karşılaştırma tablosu.
- **Bağımlılık yok:** saf JavaScript (ES modülleri), derleme adımı yok. Arayüz Türkçe.

## Kullanım

1. Alıcı cihazda sayfayı açıp **Dinlemeyi başlat**'a bas (mikrofon izni istenir).
2. Gönderen cihazda metni yaz ya da **Görsel / dosya** sekmesinden bir dosya seç (sürükle-bırak ve
   yapıştırma da olur; telefonda doğrudan fotoğraf çekilebilir).
3. **Yöntem**, **Frekans bandı** ve **Hız** seç, **Sese çevir ve çal**'a bas.

Hangi yöntem? Varsayılan **Mod 1 · MFSK**: oda içinde birkaç metrede, elde tutarken ve yüksek seste
en az sürprizli olanı. Mod 2–8 deneyseldir; Yöntem'in altındaki **Deneysel yöntemleri aç** kutusuyla
seçilebilir hâle gelir. Kutu açıkken canlı dinleme de deneysel yöntemleri çözer; kapalıyken yalnız
Mod 1'i dinler (telefonda işlemci payı kalsın diye). Deneysel yöntem kullanılacaksa kutu **alan
cihazda da** açık olmalı; dosyadan çözme ve simülasyon ise her zaman tüm yöntemleri dener.

Deneyseller arasında, simülatöre göre: gürültü sinyalden güçlüyse ve uzak mesafede **CSS**, **DSSS**
ya da **FT8** (Sağlam); çok yankılı salonda ve cihaz hareket ederken **JANUS** ve **DSSS**; cihazlar
yakınken, görsel ve dosya için **OFDM-QAM** (en hızlısı) ya da **DQPSK-OFDM**. **SC-DFE** de yakın
mesafe içindir; karşılaştırma tablolarına henüz eklenmedi.

İpuçları:

- Ses seviyesi %50–90 arası iyi. CSS sabit zarflıdır, yüksek seste de bozulmaz.
- Turbo için cihazları yan yana koy. CSS Sağlam'da (en uzun semboller) cihazları sabit tut.
  Yüksek ve ultrasonik bantlarda hoparlörü alıcının mikrofonuna çevir.
- Bluetooth hoparlör/kulaklık sesi sıkıştırıp tonları bozabilir. iPhone'da sessiz mod anahtarı sesi
  kapatabilir. macOS'ta Denetim Merkezi → Mikrofon Modu **Standart** olmalı ("Ses Yalıtımı" tonları siler).
- Telefonda dinlerken ekranı açık, sayfayı önde tut; arka planda tarayıcı mikrofonu durdurabilir.
- Mikrofon için sayfa HTTPS üzerinden (ya da `localhost`'tan) açılmalı.

## Yöntemler

### Mod 1 · MFSK — frekans atlamalı ton kümeleri (varsayılan)

Her 4 bit 16 frekanstan biri olarak çalınır; profile göre aynı anda 1–4 ton. Ardışık semboller
dönüşümlü ton kümeleri kullanır: bir önceki sembolün oda yankısı, çözülen kümeye düşmez; bir kümenin
yeniden duyulmasına kadar geçen süre ("yankı yaşı") yankıya dayanıklılığı belirler. Çözme Hann
pencereli Goertzel ile; her kararın güven marjı tutulur ve şüpheli baytlar Reed-Solomon'a silinti
olarak verilir (2·hata + silinti ≤ parite). MFSK16 [1] ve ggwave [2] çizgisinde.

### Mod 2 · CSS — LoRa tipi chirp yayılı spektrum (deneysel)

Her sembol, bandı T = 2^SF / B sürede tarayan bir yukarı chirp'tir; bilgi, başlangıç frekansının
döngüsel kaymasındadır (2^SF kayma → SF bit) [3]. Alıcı sembolü temel banda indirip çip hızında
örnekler, temel aşağı chirp'le çarpar ("dechirp") ve 2^SF noktalı FFT'de tek bir tepe arar: sinyalin
enerjisi tek kutuda toplanırken gürültü ve dağınık oda yankısı tüm kutulara yayılır (işlem kazancı
2^SF; SF 8'de 24 dB). Havadan akustik iletişimde chirp'in uzun menzili ve yankıya dayanıklılığı [4]'te
gösterilmiştir.

- **Kodlama:** semboller Gray kodludur (komşu kutuya kayma tek bit hatası verir). Bitler K = 7,
  oran 1/2 evrişimli kodla (üreteçler 171/133, NASA/CCSDS [6]) korunur ve serpiştirilir. Alıcı her bit
  için kutu genliklerinden LLR üretir, yumuşak kararlı Viterbi [5] ile çözer. Dışta Reed-Solomon [8]
  kalan hata demetlerini temizler (birleştirilmiş kod [7]).
- **Zaman ve Doppler izleme:** chirp'te zaman kayması τ ile frekans kayması ε birbirine karışır;
  ikisi de dechirp tonunu ε − τ kadar kaydırır. Onları ayıran, chirp'in sarma anındaki faz
  sıçramasıdır: sarmadan sonraki kesim 2πτ ek faz taşır, ε ise sıçrama yaratmaz. İki kesimin tutarlı
  toplamlarından önce ton frekansı, sonra aradaki faz farkından τ bulunur; tutarlı toplamlar yalnız
  doğrudan yolun frekansında alındığından oda yankısı kestirimi saptırmaz. τ, kazancı ölçümün
  güvenilirliğine göre ayarlanan bir alfa-beta izleyiciyle (sabit kazançlı Kalman [9]) izlenir. Paket
  başındaki üç başvuru sembolü (sarma ortada) ilk zamanlamayı, saat farkının hızını ve Doppler'i verir.
- **Senkron eşiği:** uzun ve geniş bantlı senkron chirp'inde gürültünün ilintisi ~1/√(T·B) olduğundan
  eşik buna göre düşürülür; yankı + gürültüde paketler kaçmaz.

### Mod 3 · DQPSK-OFDM — zaman-frekans serpiştirmeli çok taşıyıcı (deneysel)

Bantta 100 Hz aralıklı onlarca alt taşıyıcı birden çalar; sembol 10 ms + 3,3 ms koruma aralığı.
Her taşıyıcı bir önceki kullanımına göre faz farkıyla 2 bit (DQPSK) ya da 1 bit (DBPSK) taşır;
hoparlörün, mikrofonun ve odanın etkisi farkta düşer, kanal kestirimi gerekmez (DAB [10]; akustik
OFDM için bkz. [11]). Oda yankısı koruma aralığından çok uzun sürdüğü için taşıyıcılar bloklara
bölünür ve her sembolde tek blok çalar: bir blok, eski yankısı sönünce yeniden kullanılır. Saat
farkı ve hareket, fazda frekansla orantılı bir eğim olarak ölçülür (verinin M. kuvvetiyle modülasyon
silinip sıfırdan geçen doğruya en küçük kareler) ve her sembolde düzeltilir. MFSK'nin 5–15 katı hız;
yankı arttıkça hata artar, yakın mesafe içindir.

### Mod 4 · DSSS — doğrudan dizili yayılı spektrum, DBPSK ve RAKE alıcı (deneysel)

Her kodlu bit bir semboldür: N çiplik sözde rastgele bir kesim bitin işaretiyle çarpılır ve taşıyıcıda
BPSK olarak çalınır; çip darbesi kök yükseltilmiş kosinüstür (β = 0,5, standart bantta 4000 çip/sn).
Hızlı profiller IEEE 802.11'deki gibi her bitte aynı 11 çipli Barker dizisini kullanır [13]; Normal ve
Sağlam'da bit başına 31/63 çip, PRBS-15 m-dizisinin ardışık kesimleridir (uzun kod). Bitler diferansiyel
kodlanır (DBPSK): taşıyıcı fazı ve odanın her yoldaki fazı farkta düşer [14]. Alıcı biti kesimin kaydırılmış
kopyalarıyla ilişkilendirip bir gecikme profili çıkarır; ayrı gelen yankı yolları ayrı tepeler verir.
RAKE alıcı [15] en güçlü en çok dört yolu "kol" olarak seçer ve ölçümlerini toplar; işlem kazancı N
gürültüyü ve geç yankıyı N kat bastırır.

- **Kodlama ve LLR:** bitler K = 7 evrişimli kodla [6] korunur, başlık ve veri ayrı serpiştirilir. Kol
  başına LLR, fazı bilinmeyen iki ardışık sembolün tam olabilirlik oranıdır (ln I0 farkı); düşük SNR'de
  ağırlıklı diferansiyel birleştirmeye (Σ w·Re{y[n]·y*[n−1]}) indirgenir. Gürültü + girişim düzeyi gecikme
  profilinden ölçülür; LLR'ler Viterbi [5] ve RS silintileri için gerçekçi ölçeklidir.
- **Yankı:** geç yankı (RT60 0,4–1,2 s) önceki bitlerin verisini taşıyan bir öz girişimdir. m-dizisinin kısmi
  ilintileri √N mertebesinde olduğundan kısa kodda bu girişim iki katına çıkar; uzun kod onu yarıya indirir
  (çok uzak salonda DSSS Normal %10 → %100). Kollar, o anki kararla tutarlı "diferansiyel" profilden seçilir;
  yalnız güç profili, yankının sabit girişim deseninden sahte kollar doğururdu.
- **Zaman izleme:** başvuru bitleri ilk zamanlamayı verir; sonra ana kolda erken-geç ayırıcılı, ikinci
  dereceden bir gecikme kilitli döngü (DLL) [16] izler. Saat farkı ve hareketin yaptığı bit başı faz dönmesi
  karar yönlendirmeli kestirilir.
- **802.11'den farklar:** akustik bant ve çip hızı; Sağlam ve Normal'de uzun kod; evrişimli kod ve
  serpiştirme (802.11 DSSS'te kanal kodu yok); SYNC + SFD yerine chirp ve kısa başvuru dizisi; RRC darbe
  ve hafif temel bant kırpması; 2 Mbit/sn DQPSK ve CCK yok.
- **Simülatörde:** Sağlam ve Normal 18 koşulun hepsinde %100. DBPSK, CSS'in 2^SF'li kiplemesinden enerji
  açısından daha az verimli (CSS Normal aynı dayanıklılıkta 1,45 kat hızlı); buna karşılık DSSS elde sallamaya
  ve ultrasonik bantta harekete CSS'ten dayanıklı. Barker-11'li hızlı profiller yankılı salonda zayıftır.
  Tepe/RMS oranı CSS'ten ~2 dB yüksektir; simülatör SNR'yi RMS'e göre ölçtüğünden bu bedel tablolarda görünmez.

### Mod 5 · JANUS — frekans atlamalı ikili FSK (deneysel)

NATO'nun su altı akustik haberleşme standardı JANUS [17, 18] çizgisinde: bant 13 alt banda bölünür, her alt
bantta iki ton vardır (26 ton). Her kodlu bit bir çiptir; çipin hangi ton çiftinde çalınacağını frekans atlama
dizisi, çiftin hangi tonunun çalınacağını bitin kendisi belirler. Bitler JANUS'un iç kodu olan K = 9, oran 1/2
evrişimli kodla (üreteçler 753/561) korunur, serpiştirilir ve yumuşak kararlı Viterbi [5] ile çözülür; dışta
Reed-Solomon [8] kalır. Paket, senkron chirp'inden sonra 32 çiplik sabit bir önsözle başlar. Alıcı ton
enerjilerini evresiz karşılaştırır; evre, kanal kestirimi ve eşitleyici gerekmez. Bu yüzden yankıya, Doppler'e
ve kırpmaya dayanıklıdır, ama en yavaş yöntemdir (net 2,8–5,7 bayt/sn).

- **Havaya uyarlama:** atlama dizisi h(k) = 5k mod 13 her 13 çipte her çifti bir kez kullanır; bir çift ancak
  12 çip sonra yeniden duyulur (yankı yaşı 120–240 ms; MFSK'nin ton kümeleriyle aynı fikir). Ardışık çipler
  bandın ~%40'ı uzakta, çift içindeki iki ton bitişik. Çip süresi 10–20 ms (JANUS'ta 6,25 ms); ton aralığı
  Hann penceresine göre 2,3–4 / çip süresi.
- **Yankıyı hesaba katan LLR:** gürültü tabanı o an çalınmayan tonlardan, yankının sönüm profili boştaki
  çiftlerden ölçülür; 13 çip önce hangi ton çalındıysa onda beklenen yankı girişime eklenir. Her dal için
  Rayleigh sönümlü kare-yasa LLR kullanılır [14].
- **Yankı kuyruğunu toplama:** çip susunca kendi yankısı aynı tonda sürer; bu, oda yanıtının başka bir
  kesiminden gelen bağımsız bir kopyadır. Çipin çifti sonraki ~180 ms boyunca okunur, her gecikme ayrı bir
  çeşitleme dalı olarak kare-yasa birleştirilir [14]. Simülatörde ham çip hata oranı çok uzak salonda (RT60
  1,2 s, DRR −12 dB) %2,3'ten sıfıra, kilise gibi salonda (RT60 2 s) %12,7'den %0,1'e indi.
- **Zamanlama:** çeyrek çip erken/geç pencerelerin enerji farkı. Yankının bu farka verdiği kalıcı eğilim ilk
  96 çipte ölçülüp çıkarılır; sonra saat farkı ve hareket ikinci dereceden bir döngüyle izlenir.
- **Standarttan sapmalar:** bant, çip süresi ve ton aralığı havaya göre seçildi. Atlama dizisi, serpiştirici
  (asal adımlı) ve önsözün bitleri standardınkiler değil. Algılama bandın ortak chirp'iyle yapılır. Çerçeve
  JANUS'un 64 bitlik temel paketi değil, Sonik'in başlığı ve RS + CRC-32'li verisidir. Bir JANUS modemiyle
  uyumlu değildir.

### Mod 6 · OFDM-QAM — pilotlu, koherent OFDM (deneysel)

Mod 3 ile aynı ızgarayı kullanır (100 Hz aralıklı alt taşıyıcılar, 10 ms + 3,3 ms koruma aralığı), ama
koherenttir: bilgi, taşıyıcının bir önceki kullanımına göre faz farkında değil, kendi genlik ve fazındadır
(QPSK 2 bit, 16-QAM 4 bit, Gray eşleme). Yapı IEEE 802.11a OFDM fiziksel katmanını izler [19]. Paket başındaki
iki eğitim turunun ortalaması her taşıyıcının kazancını ve fazını verir (komşu taşıyıcılarla ortalanır [21]);
farkları gürültüyü, aralarındaki faz eğimi saat farkının hızını verir. Her sembolde 4 pilot taşıyıcı (802.11a'nın
127 bitlik karıştırıcı dizisiyle kutuplanmış) ortak faz kaymasını izler. Seste taşıyıcı osilatörü yoktur; bu
kayma frekansla orantılı bir faz eğimidir ve tek bir gecikmeyle açıklanır. Gecikme her sembolde pilotlardan ve
karar verilen veri taşıyıcılarından ölçülüp Kalman süzgeciyle [23] izlenir, FFT penceresi de onunla kayar.
Bitler 802.11a'nın K = 7 evrişimli koduyla korunur ve iki adımlı serpiştiriciden geçer; alıcı her bit için
max-log LLR üretir [20] ve yumuşak kararlı Viterbi [5] ile çözer. Akustik OFDM için bkz. [11].

- **Yankı:** koruma aralığını aşan oda yankısı gürültü gibi girişime dönüşür; bandın tamamını her sembolde
  kullanan profillerde sinyal/girişim oranı DRR'ye yakındır. Turbo (16-QAM) ve Çok hızlı (QPSK) bu yüzden
  yakın mesafe içindir. Hızlı, taşıyıcıları 3 bloğa bölüp her sembolde birini çalar (Mod 3'teki atlama;
  koherent OFDM'de bant atlamanın örneği MB-OFDM [22]): bir taşıyıcı 40 ms sonra yeniden çalar, DRR 0 dB'lik
  odada da çözülür.
- **Kanal ve gürültü izleme:** kanal kestirimi her kararla güncellenir, taşıyıcı başına gürültü izlenir;
  LLR'ler buna göre ölçeklenir. Telefon hoparlörünün zayıf bantları ve konuşmanın örttüğü taşıyıcılar düşük
  güven alır.
- **802.11a'dan farklar:** zaman ölçeği (µs yerine ms); kısa eğitim yerine chirp senkronu; frekans kayması
  yerine zaman ölçeği kayması; blok atlama; turlar arası zaman serpiştirmesi (konuşma gibi patlama gürültüsüne
  karşı); başlık en az 3 sembole yayılır; yalnız oran 1/2; dışta Reed-Solomon.
- **Simülatörde:** Turbo net 1295 B/sn ile Mod 3 Turbo'nun 3,5 katı hızdadır, ama yalnız yan yana ve SNR ≥
  10–12 dB'de çözer; 50 cm'de çözemez. Çok hızlı (648 B/sn) yakın mesafede Mod 3 Turbo kadar sağlamdır,
  konuşma girişiminde daha iyidir. Hızlı (187 B/sn) her koşulda Mod 3 Çok hızlı (144 B/sn) kadar ya da daha
  iyidir. Uzak ve çok yankılı ortamda hiçbir OFDM-QAM profili çözemez.

### Mod 7 · FT8 — 8-GFSK, Costas senkronu ve LDPC(174, 91) (deneysel)

FT8, amatör telsizde çok zayıf sinyaller için geliştirilmiş kipin [24] havadan sese uyarlanmışıdır. Sekiz tonlu,
sürekli fazlı frekans kaydırma kullanır: sembol başına 3 bit (Gray kodlu), ton aralığı sembol süresinin tersi
(h = 1; tonlar sembol boyunca diktir), frekans geçişleri Gauss süzgeçle yumuşatılır (GFSK, BT = 2). Her çerçeve
79 semboldür: S7 D29 S7 D29 S7. S7, 7 × 7 Costas dizisidir ({3, 1, 4, 0, 6, 5, 2}); zaman ve frekans
kaymalarında tek bir keskin ilinti tepesi verir [26]. Alıcı her blokta zamanı ve Doppler'i buradan ölçer,
alfa-beta izleyiciyle [9] izler. 58 veri sembolü tam bir LDPC(174, 91) kod sözcüğüdür [27]; üreteç ve denetim
tabloları FT8'in kendi kodudur (ft8_lib [25], MIT lisansı). Alıcı inanç yayılımıyla (sum-product [28]) çözer.

Özgün FT8'de sembol 160 ms, ton aralığı 6,25 Hz'dir (77 bit 12,64 saniyede). Sonik'te sembol süresi ve ton
aralığı birlikte ölçeklenir (80 ms / 12,5 Hz ve 40 ms / 25 Hz; h = 1 korunur). Hız için 2–4 FT8 sinyali farklı
frekans kaymalarında aynı anda çalar (FT8 kullanıcılarının bandı paylaşması gibi). FT8'in 14 bitlik CRC'si
yerine paketin RS + CRC-32 çerçevesi kullanılır. Bit akışı 91 bitlik bloklara bölünür; son bloğun sıfır
tamamlama bitlerini alıcı bildiği için bu blok kısaltılmış kod gibi güçlenir (başlık: 56 bilgi + 35 bilinen bit).

- **Alıcı:** her sembolde 8 tonun enerjisi dikdörtgen pencereli DFT ile ölçülür. Bit LLR'leri eş fazsız FSK'nin
  olabilirlik oranından (Rice/Rayleigh) gelir; düzeyler Costas sembollerinden ve güvenli kararlardan
  kestirilir, böylece LLR'ler inanç yayılımının istediği gerçek ölçeğe yakındır.
- **Yankı (FT8'de olmayan, alıcıya eklenen önlem):** ton kümesi değiştirmeyen 8-FSK'de önceki sembolün yankısı
  şimdiki pencerede hep 8 tondan birine düşer. Simülatörde odada (RT60 0,5 s, DRR 0 dB) sembol hatalarının
  %82'si "önceki sembolün tonu"ydu. Dalga formuna dokunmadan alıcıya iki şey eklendi: ton başına kanal modeli
  (her tonun doğrudan, yankı ve tekrar düzeyleri ayrı öğrenilir) ve her 29 sembollük veri bloğunda durumu
  "önceki ton" olan 8 durumlu kafeste ileri-geri çözüm (BCJR [29]). Bloğun iki ucundaki Costas tonları bilinen
  durumlardır. Yankı böylece gürültü değil, önceki sembol için ek kanıt olur.
- **Nerede iyi, nerede değil:** en düşük SNR'de Sağlam (3,1 B/sn) CSS Sağlam kadar dayanıklıdır (−15 dB'de
  %100); el titremesi ve sallamada CSS'ten iyidir. Aynı hızda gürültüde CSS'in gerisindedir (8 ton, CSS'te 256
  kayma). Çok yankılı salonda (DRR ≤ −8 dB) ton kümesi atlayan MFSK'nin gerisinde kalır. Çok alt kanallı
  profillerde zarf sabit değildir: hoparlör aynı tepe genliğiyle sürüldüğünde ortalama güç ~1/N'ye düşer;
  simülatördeki SNR ortalama güce göre olduğundan bu kayıp tablolarda görünmez.

### Mod 8 · SC-DFE — tek taşıyıcılı koherent PSK ve uyarlamalı karar geri beslemeli eşitleyici (deneysel)

Su altı akustiğinde yüksek hızın klasik yolu [30]: tek bir taşıyıcıda BPSK ya da Gray kodlu QPSK, kök
yükseltilmiş kosinüs darbe (β = 0,5), sembol hızı bandı doldurur (standart bantta 4000, yüksek bantta
3667 sembol/sn). Çok taşıyıcılı yöntemlerin tersine koruma aralığı yoktur; oda yankısının yol açtığı
semboller arası girişimi (ISI) alıcıdaki eşitleyici öğrenip temizler. Alıcı, Stojanovic, Catipovic ve
Proakis'in [30] yapısını izler: yarım sembol aralıklı 12 dokulu ileri besleme süzgeci (FF), geçmiş
kararlardan beslenen 24 dokulu geri besleme süzgeci (FB) ve ikinci dereceden sayısal faz kilitli döngü
(DPLL, [33]) birlikte, ortalama kare hatayı en aza indirecek biçimde uyarlanır; katsayılar üstel
ağırlıklı RLS ile (λ = 0,998) [31]. Bitler K = 7 evrişimli kodla [6] korunur, serpiştirilir ve PRBS-15
ile beyazlatılır; alıcı eşitleyici çıkışından Gauss yaklaşımıyla LLR üretir, yumuşak kararlı Viterbi
[5] ile çözer.

- **Kazanım:** paket başındaki 128 bilinen sembol bir gecikme penceresinde (senkrondan −2/+6 ms)
  ilişkilendirilir. En güçlü tepenin −6 dB'lik payındaki ilk yol ana yoldur: ondan sonra gelen
  yansımalar FB'nin temizleyeceği son imleçler olur. İlintinin fazı DPLL'yi, dizinin iki yarısı
  arasındaki faz farkı frekansını başlatır; sonra süzgeçler eğitim dizisi boyunca RLS ile eğitilir.
- **Sondalar:** veri 96 sembollük bloklara bölünür, aralarına 8 bilinen sembol girer (MIL-STD-188-110
  tek tonlu modemindeki gibi [32]; hız payı %7,7). Eşitleyici her blokta hatasız başvuru alır; karar
  hatalarının geri beslemede birbirini doğurması (hata yayılımı) bloğu aşmaz.
- **Zaman ölçeği:** seste taşıyıcı osilatörü yoktur; saat farkı, 44,1 ↔ 48 kHz ve hareket zamanı
  ölçekler, bu da temel bantta fc ile orantılı bir faz dönmesi olarak görünür. DPLL'nin tümlevci durumu
  (sembol başı faz artışı ν) bu yüzden zaman ölçeğinin de ölçüsüdür: örnekleme anı her sembolde
  −ν / (2π·fc) kaydırılır. Ayrı bir zamanlama döngüsü gerekmez.
- **Yankı:** FB'nin kapsamı 24 sembol, yani ~6 ms'dir. Bunun içindeki yansımaları eşitleyici tamamen
  temizler (testte 0,75 ve 2 ms'lik iki güçlü yansımada çıkış SINR'ı 65 dB). Daha geç gelen yankı
  gürültü gibi kalır: RT60 0,5 s'lik odada yankı enerjisinin yalnız ~%15'i ilk 6 ms'dedir. Bu yüzden
  Mod 6 gibi yakın mesafe içindir.
- **Stojanovic vd. 1994'ten sapmalar:** tek mikrofon (çok kanallı uzamsal birleştirme yok); ses bandı;
  eğitim yalnız başta değil, sondalarla da; zaman ölçeği DPLL'den izlenir; kararlar kod çözülmeden
  geri beslenir (turbo eşitleme yok); dışta Sonik'in RS'si.

### Ortak katmanlar

```
│ chirp │ boşluk │ başlık (uzunluk, tür, profil) │ veri + CRC-32 │ RS parite │
  senkron          ← yöntemin sembolleri: ton, chirp, çip ya da alt taşıyıcı →
```

- **Senkron:** her paket bir chirp ile başlar; alıcı gelen sesi FFT tabanlı normalize korelasyonla
  şablonlara benzetip paket başını örnek düzeyinde bulur. Aynı bantta benzer profiller bir chirp'i
  paylaşır; hangi profil olduğu başlıktaki profil numarasından anlaşılır.
- **Başlık (sürüm 3):** 12 bit uzunluk, 8 bit profil no, şifreli ve tür bayrakları, 4 bayt RS.
- **İç kod:** MFSK ve DQPSK-OFDM sert kararlıdır; güveni düşük baytlar RS'ye silinti olarak gider. Diğer
  yöntemlerde başlık ve veri bitleri ayrıca bir iç kodla korunur: CSS, DSSS, OFDM-QAM ve SC-DFE'de K = 7 (171/133),
  JANUS'ta K = 9 (753/561) evrişimli kod ve yumuşak kararlı Viterbi; FT8'de LDPC(174, 91) ve inanç yayılımı.
  İç kod bayt başına bir güven de verir; RS silintileri ondan seçilir (birleştirilmiş kod [7]).
- **Ortak senkron:** yeni yöntemler bantlarındaki mevcut chirp'i paylaşır (DSSS, JANUS ve FT8 CSS'inkini,
  OFDM-QAM ve SC-DFE OFDM'ninkini). Karşılaştırmada her yöntem aynı senkronla başlar; dinlerken işlemci yükü de
  yöntem sayısıyla artmaz.
- **Görsel ve dosya:** içerik K parçaya bölünür, sütun sütun Reed-Solomon ile M eşlik parçası
  üretilir (paket kayıplarına karşı silinti kodu [12]): alıcı herhangi K farklı parçayı duyunca
  içeriği kurar. Parça boyu yayın süresini en aza indirecek şekilde seçilir.
- **Canlı önizleme:** kod sistematiktir ve parçalar sırayla gider, yani ilk K parça içeriğin
  kendisidir. Alıcı baştan kesintisiz gelen parçaları, kapanmamış bir akış olarak tarayıcının görsel
  çözücüsüne (WebCodecs `ImageDecoder`) verir; çözücü o ana kadar çözebildiği satırları döndürür.
  `<img>` kesik bir WebP'yi hiç göstermediği için bu yol gerekir. VP8 tüm blokların kiplerini dosyanın
  başında topladığından WebP'nin ilk satırları verinin ~%30'u gelince görünür.
- **Güvenlik:** alınan metin DOM'a yalnız `textContent` ile yazılır. Görsel, gönderenin bildirdiği
  türe bakılmadan imzasından tanınıyorsa (PNG, JPEG, GIF, WebP) ve boyutu makulse gösterilir; diğer
  her şey yalnız indirilir, dosya adı temizlenir. Sayfa sıkı bir CSP ile sunulur. Ses bir yayındır:
  yakındaki herkes çözebilir, gizli içerik için parola kullan.

## Profiller

Net hız: kiplemenin ham hızı × iç kod oranı × RS oranı (bayt/sn); paket başı yük (senkron, başlık,
başvuru sembolleri) hariç, çerçeve içindeki pilot ve senkron sembolleri dahil. Yöntemleri
karşılaştırmak için ham hızdan daha dürüsttür.

| Yöntem | Profil | Net hız | Bant | Yapı | Ne zaman |
|---|---|---:|---|---|---|
| 1 · MFSK | Sağlam | 3,3 | 1,5–3,7 kHz | 1 kanal | uzak, gürültülü, çok yankılı |
| 1 · MFSK | Normal | 12,8 | 1,5–9 kHz | 2 kanal | 1–3 m, yankılı oda |
| 1 · MFSK | Hızlı | 27,6 | 1,5–9,1 kHz | 4 kanal | ≤ 1 m |
| 1 · MFSK | Yüksek | 12,8 | 11,3–17,2 kHz | 2 kanal | 1–2 m, daha az duyulur |
| 1 · MFSK | Yüksek · Hızlı | 20,7 | 11,3–17,2 kHz | 3 kanal | ≤ 1 m |
| 1 · MFSK | Ultrasonik | 6,7 | 17,3–20,4 kHz | 1 kanal | neredeyse duyulmaz |
| 1 · MFSK | Ultrasonik · Hızlı | 13,5 | 17,3–20,4 kHz | 2 kanal | ≤ 1 m |
| 2 · CSS | CSS · Sağlam | 3,3 | 1,7–8,3 kHz | SF 10 | en uzun menzil; cihazlar sabit |
| 2 · CSS | CSS · Normal | 10,7 | 1,7–8,3 kHz | SF 8 | uzak ve gürültülü ortam |
| 2 · CSS | CSS · Hızlı | 18,6 | 1,7–8,3 kHz | SF 7 | oda içi, birkaç metre |
| 2 · CSS | CSS · Yüksek | 9,8 | 11,2–17,3 kHz | SF 8 | uzak; daha az duyulur |
| 2 · CSS | CSS · Yüksek · Hızlı | 17,1 | 11,2–17,3 kHz | SF 7 | oda içi; daha az duyulur |
| 2 · CSS | CSS · Ultrasonik | 5 | 17,4–20,6 kHz | SF 8 | neredeyse duyulmaz; cihazlar sabit |
| 2 · CSS | CSS · Ultrasonik · Hızlı | 8,7 | 17,4–20,6 kHz | SF 7 | neredeyse duyulmaz; oda içi |
| 3 · OFDM | Çok hızlı | 144 | 1,8–10,2 kHz | DQPSK, 8 blok | oda içinde ≤ 1 m; görsel |
| 3 · OFDM | Turbo | 375 | 1,8–10,2 kHz | DQPSK, 3 blok | cihazlar yakın (≤ 50 cm) |
| 3 · OFDM | Yüksek · Çok hızlı | 57,7 | 11,3–17,2 kHz | DBPSK, 6 blok | oda içinde ≤ 1 m |
| 3 · OFDM | Yüksek · Turbo | 260 | 11,3–17,2 kHz | DQPSK, 3 blok | cihazlar yakın (≤ 50 cm) |
| 3 · OFDM | Ultrasonik · Turbo | 202 | 17,4–20,4 kHz | DQPSK, 2 blok | yan yana (≤ 30 cm) |
| 4 · DSSS | DSSS · Sağlam | 3,6 | 1,7–8,3 kHz | 63 çip, uzun kod | çok uzak, çok yankılı; gürültü sinyalden güçlü |
| 4 · DSSS | DSSS · Normal | 7,3 | 1,7–8,3 kHz | 31 çip, uzun kod | gürültülü ortam, uzak oda; hareket |
| 4 · DSSS | DSSS · Hızlı | 20,7 | 1,7–8,3 kHz | Barker-11 | oda içi, birkaç metre |
| 4 · DSSS | DSSS · Ultrasonik · Hızlı | 9,6 | 17,4–20,6 kHz | Barker-11 | neredeyse duyulmaz; oda içi, elde |
| 5 · JANUS | JANUS · Sağlam | 2,8 | 1,7–8,3 kHz | 20 ms çip | çok yankılı salon, uzak, düşük SNR; elde |
| 5 · JANUS | JANUS · Normal | 5,7 | 1,7–8,3 kHz | 10 ms çip | yankılı salon, uzak; hareket |
| 5 · JANUS | JANUS · Yüksek | 5,7 | 11,2–17,3 kHz | 10 ms çip | yankılı salon, uzak; daha az duyulur |
| 5 · JANUS | JANUS · Ultrasonik | 2,8 | 17,4–20,6 kHz | 20 ms çip | neredeyse duyulmaz |
| 6 · OFDM-QAM | OFDM-QAM · Turbo | 1295 | 1,8–10,2 kHz | 16-QAM, tek blok | yan yana (≤ 20 cm), sessiz |
| 6 · OFDM-QAM | OFDM-QAM · Çok hızlı | 648 | 1,8–10,2 kHz | QPSK, tek blok | ≤ 50 cm; görsel ve dosya |
| 6 · OFDM-QAM | OFDM-QAM · Hızlı | 187 | 1,8–10,2 kHz | QPSK, 3 blok | oda içinde ≤ 1 m |
| 6 · OFDM-QAM | OFDM-QAM · Yüksek · Çok hızlı | 435 | 11,3–17,2 kHz | QPSK, tek blok | ≤ 50 cm; daha az duyulur |
| 7 · FT8 | FT8 · Sağlam | 3,1 | 1,7–8,3 kHz | 80 ms, 2 alt kanal | çok düşük SNR, uzak |
| 7 · FT8 | FT8 · Normal | 6,3 | 1,7–8,3 kHz | 80 ms, 4 alt kanal | düşük SNR, gürültülü ortam |
| 7 · FT8 | FT8 · Hızlı | 9,4 | 1,7–8,3 kHz | 40 ms, 3 alt kanal | oda içi, birkaç metre |
| 7 · FT8 | FT8 · Yüksek | 9,4 | 11,2–17,3 kHz | 40 ms, 3 alt kanal | düşük SNR, oda içi; daha az duyulur |
| 8 · SC-DFE | SC-DFE · Hızlı | 210 | 2–8 kHz | BPSK, 4000 Bd | yakın (≤ 1 m), az yankı |
| 8 · SC-DFE | SC-DFE · Çok hızlı | 420 | 2–8 kHz | QPSK, 4000 Bd | ≤ 50 cm; görsel ve dosya |
| 8 · SC-DFE | SC-DFE · Yüksek · Çok hızlı | 385 | 11,5–17 kHz | QPSK, 3667 Bd | ≤ 50 cm; daha az duyulur |

## Karşılaştırma

Kanal simülatöründe paket başarısı (%, standart bant, hücre başına 10 deneme, kısa metin mesajları;
`npm run bench -- --trials 10 --profile …`). Her hücrede aynı mesajlar ve aynı kanal gerçeklemeleri
kullanılır. SNR bant içidir ve ortalama güce göre ölçülür; DRR doğrudan sesin yankıya oranıdır
(küçüldükçe uzak).

Mod 8 (SC-DFE) bu tablolara henüz eklenmedi.

**Sağlam (S.) ve Normal (N.) kademeleri**

| Koşul | MFSK S. | CSS S. | DSSS S. | JANUS S. | FT8 S. | MFSK N. | CSS N. | DSSS N. | JANUS N. | FT8 N. |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| *net hız (B/sn)* | *3,3* | *3,3* | *3,6* | *2,8* | *3,1* | *12,8* | *10,7* | *7,3* | *5,7* | *6,3* |
| temiz | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| SNR 10 dB | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| SNR 0 dB | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| SNR −10 dB | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| SNR −15 dB | 20 | 100 | 100 | 100 | 100 | 0 | 100 | 100 | 0 | 90 |
| yan yana (RT60 0,4 s, DRR +15 dB) | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| 50 cm (RT60 0,5 s, DRR +6 dB) | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| oda (RT60 0,5 s, DRR 0 dB) | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| uzak (RT60 0,6 s, DRR −5 dB) | 100 | 100 | 100 | 100 | 90 | 100 | 100 | 100 | 100 | 100 |
| yankılı salon (RT60 1 s, DRR −8 dB) | 100 | 100 | 100 | 100 | 80 | 90 | 90 | 100 | 100 | 60 |
| çok uzak (RT60 1,2 s, DRR −12 dB, SNR 5 dB) | 90 | 100 | 100 | 100 | 20 | 20 | 100 | 100 | 100 | 40 |
| telefon hoparlörü + oda | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| konuşma girişimi 0 dB | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| elde titreme ±1 cm + oda | 100 | 50 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| sallama ±3 cm + oda | 100 | 0 | 100 | 100 | 100 | 100 | 90 | 100 | 100 | 100 |
| yaklaşma 10 cm/sn + oda | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| kırpma (8×) + oda | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 90 |
| 44,1→48 kHz, +120 ppm, uzak | 100 | 100 | 100 | 100 | 100 | 90 | 100 | 100 | 100 | 100 |

**Hızlı kademeler** (H. Hızlı, ÇH Çok hızlı, T. Turbo)

| Koşul | MFSK H. | CSS H. | DSSS H. | FT8 H. | QAM H. | OFDM ÇH | QAM ÇH | OFDM T. | QAM T. |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| *net hız (B/sn)* | *27,6* | *18,6* | *20,7* | *9,4* | *187* | *144* | *648* | *375* | *1295* |
| temiz | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| SNR 10 dB | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| SNR 0 dB | 100 | 100 | 100 | 100 | 100 | 40 | 0 | 0 | 0 |
| SNR −10 dB | 60 | 100 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| SNR −15 dB | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| yan yana (RT60 0,4 s, DRR +15 dB) | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| 50 cm (RT60 0,5 s, DRR +6 dB) | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 10 |
| oda (RT60 0,5 s, DRR 0 dB) | 100 | 100 | 100 | 100 | 100 | 100 | 0 | 0 | 0 |
| uzak (RT60 0,6 s, DRR −5 dB) | 100 | 100 | 100 | 60 | 0 | 0 | 0 | 0 | 0 |
| yankılı salon (RT60 1 s, DRR −8 dB) | 20 | 100 | 90 | 10 | 0 | 0 | 0 | 0 | 0 |
| çok uzak (RT60 1,2 s, DRR −12 dB, SNR 5 dB) | 0 | 50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| telefon hoparlörü + oda | 100 | 100 | 100 | 100 | 100 | 100 | 0 | 0 | 0 |
| konuşma girişimi 0 dB | 100 | 100 | 100 | 100 | 100 | 80 | 90 | 10 | 0 |
| elde titreme ±1 cm + oda | 100 | 100 | 100 | 100 | 100 | 90 | 0 | 0 | 0 |
| sallama ±3 cm + oda | 100 | 100 | 100 | 100 | 100 | 50 | 0 | 0 | 0 |
| yaklaşma 10 cm/sn + oda | 100 | 100 | 100 | 100 | 100 | 100 | 0 | 0 | 0 |
| kırpma (8×) + oda | 100 | 100 | 100 | 100 | 100 | 0 | 0 | 0 | 0 |
| 44,1→48 kHz, +120 ppm, uzak | 100 | 100 | 100 | 50 | 0 | 0 | 0 | 0 | 0 |

Özetle:

- **Düşük SNR:** −15 dB'de Sağlam kademesinde CSS, DSSS, JANUS ve FT8 %100, MFSK %20. Normal
  kademede CSS ve DSSS %100, FT8 %90; MFSK ve JANUS %0.
- **Uzak ve çok yankılı:** CSS, DSSS ve JANUS Sağlam/Normal her koşulda en az %90. FT8 çok uzakta %20–40'ta
  kalır (sabit 8 tonlu kümede önceki sembolün yankısı), MFSK Normal %20.
- **Hareket:** CSS Sağlam'ın uzun sembolleri titreme ve sallamada zamanlamayı kaybeder (%50, %0); MFSK,
  DSSS, JANUS ve FT8 %100.
- **Hız:** yakın mesafede OFDM-QAM (Turbo yan yana 1,3 KB/sn, Çok hızlı ≤ 50 cm'de 648 B/sn). Oda içinde
  OFDM-QAM Hızlı (187 B/sn), Mod 3 Çok hızlı'dan (144 B/sn) hızlıdır ve gürültüye, sallamaya, kırpmaya daha
  dayanıklıdır; uzak odada ikisi de çözemez.
- **Bedel:** benzer dayanıklılıkta hızlar farklı: Normal kademede MFSK 12,8, CSS 10,7, DSSS 7,3, FT8 6,3,
  JANUS 5,7 B/sn. Standart koşullar Sağlam ve Normal kademelerde doyuyor; yöntemleri ayırmak için daha zor
  koşullar ve gerçek cihaz ölçümleri gerekir.

Görsel gönderme süreleri (WebP; parça ve eşlik payı dahil):

| Görsel boyutu | QAM Turbo | QAM Çok hızlı | QAM Hızlı | Turbo | Çok hızlı | Yüksek · Turbo | Ultrasonik · Turbo | MFSK Hızlı |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Küçük (160 px, ≈ 2,5 KB) | 4 sn | 7 sn | 21 sn | 10 sn | 27 sn | 14 sn | 19 sn | 2 dk 11 sn |
| Orta (320 px, ≈ 7 KB) | 10 sn | 18 sn | 53 sn | 28 sn | 69 sn | 39 sn | 51 sn | — |
| Büyük (720 px, ≈ 20 KB) | 27 sn | 46 sn | 2 dk 31 sn | 74 sn | 3 dk 14 sn | 1 dk 48 sn | 2 dk 23 sn | — |

5 dakikadan uzun sürecek aktarım başlatılmaz (telefonda ses belleği yüzlerce MB'a çıkar).

## Geliştirme

Gereken: Node.js ≥ 20. Paket kurulumu yok.

```sh
git clone https://github.com/elestirmen/sonic.git && cd sonic
npm test                 # birim + uçtan uca testler (Node, tarayıcısız)
npm run bench            # kanal koşullarına göre başarı oranı tablosu (-- --profile …, --trials …, --bytes …)
npm run serve            # http://localhost:8000 (localhost güvenli bağlamdır, mikrofon çalışır)
```

Komut satırı:

```sh
node tools/encode.js "mesaj" cikti.wav --profil css-normal [--parola …] [--hiz 48000]
node tools/encode.js --dosya foto.webp cikti.wav --profil turbo
node tools/decode.js kayit.wav [--parola …] [--cikti klasör]
```

Kanal simülatörü (`public/src/dsp/channel.js`) hoparlör/mikrofon tepkisi, oda yankısı (RT60, DRR),
cihaz hareketi (titreme, sallama, sabit hızla yaklaşma → Doppler), 44,1↔48 kHz farkı, saat kayması,
gürültü, konuşma girişimi ve kırpmayı taklit eder; testler, `bench` ve arayüzdeki "Simülasyonla
dene" onu kullanır.

## Proje yapısı

```
public/                  yalnız bu klasör yayınlanır
  index.html, style.css
  src/main.js            arayüz
  src/profiles.js        yöntemler, bantlar, hızlar ve tüm modem parametreleri
  src/modem.js           verici: bayt → paket → dalga formu (tek ya da çok paket)
  src/receiver.js        alıcı: senkron adayları → paket çözücüler (sert ve yumuşak kararlı)
  src/receiver-worker.js kodlama ve çözme işi (Web Worker)
  src/mod/               mfsk, css, ofdm, dsss, janus, qam, ft8, dfe (verici + alıcı); registry.js
  src/transfer.js        görsel/dosya: parçalama, paketler arası RS, birleştirme
  src/image.js           görsel küçültme; alınan görselin imzası ve boyutu; yarım görselin canlı çizimi
  src/crypto.js          PBKDF2 + AES-GCM
  src/codec/             crc32, reedsolomon, conv (K = 7/9 evrişimli kod, Viterbi, serpiştirme),
                         ldpc (FT8'in LDPC(174, 91) kodu, inanç yayılımı), framing (başlık, RS, iç kod)
  src/dsp/               fft, filters, chirp, sync, store, channel, pulse (RRC darbe: DSSS, SC-DFE)
  src/audio/             capture-worklet (AudioWorklet), wav
  src/ui/spectrogram.js
test/                    node --test; bench.js
tools/                   encode, decode, deploy
docs/                    README görseli
docker-compose.yml, nginx.conf
```

## Yayınlama

`public/` klasörü herhangi bir statik sunucuyla yayınlanabilir; mikrofon için HTTPS gerekir.
Depodaki yapılandırma bir `nginx:alpine` konteyneri (`sonik-web`) kullanır; `nginx.conf` önbelleği
ETag ile doğrular ve sıkı bir CSP uygular:

```sh
docker compose up -d
```

`tools/deploy.mjs`, canlı sürümün kurulumuna (Cloudflare DNS + Nginx Proxy Manager + Let's Encrypt)
özgüdür; kimlik bilgilerini ortam değişkenlerinden ya da `--env` dosyasından okur, hiçbirini yazdırmaz.
Başka bir kurulumda `DOMAIN`, `REFERENCE` ve betikteki `UPSTREAM` değiştirilmeli.

## Sınırlar

- Mod 2–8 deneyseldir: simülatörde ölçüldüler, gerçek cihazlarda henüz sınanmadılar. Canlı dinleme
  onları yalnız "Deneysel yöntemleri aç" kutusu açıkken çözer.
- OFDM ve OFDM-QAM profillerinde yankı arttıkça hata artar; Turbo'lar yakın mesafe içindir.
- SC-DFE'nin eşitleyicisi ~6 ms'ye kadarki yankıyı temizler, geç yankı gürültü gibi kalır: yakın mesafe
  içindir. Karar hataları geri beslemede çoğalabilir (hata yayılımı); sondalar bunu blokla sınırlar.
  Alıcı her sembolde 36 katsayılı RLS çalıştırır: bu makinede tek profil gerçek zamanın ~10 katı
  hızında çözülüyor, telefonda en ağır yöntem olabilir.
- JANUS ve FT8 yavaştır: kısa bir mesaj bile 4–16 saniye sürer. FT8'in ve MFSK'nin çok kanallı
  profillerinde zarf sabit değildir; aynı tepe genliğinde ortalama güç düşer (simülatörün SNR'si bunu
  göstermez). DSSS'in tepe/RMS oranı CSS'ten ~2 dB yüksektir.
- CSS'in uzun sembollü profillerinde (Sağlam, SF 10; ultrasonikte 91 ms) cihazı sallamak zamanlamayı
  sembolden sembole izlenemeyecek kadar değiştirir; bu profillerde cihazlar sabit durmalı.
- Yüksek ve ultrasonik bantların başarısı hoparlör ve mikrofona bağlıdır; bazı telefonlar 17 kHz
  üstünü zayıf çalar ya da kaydeder.
- Tarayıcı ya da işletim sistemi mikrofon sesini işlemeyi (yankı engelleme, gürültü bastırma)
  kapatmazsa tonlar bozulabilir; sayfa bunu algılayınca uyarır.
- Paket biçiminin 3. sürümü önceki sürümlerle uyumlu değildir; iki cihaz da aynı sürümü açmalı.
- Canlı görsel önizleme yalnız Chrome'da denendi; `ImageDecoder` olmayan tarayıcıda görsel eskisi gibi
  tamamlanınca açılır. Önizleme ilk eksik parçada durur ve o parça sonraki turda ya da yeterince eşlik
  parçası gelince sürer. Şifreli içerik önizlenmez (AES-GCM doğrulaması ancak sonda yapılabilir).
- Sonuçlar simülatör ölçümleridir; gerçek cihazlarla oda koşullarında ölçülmedi. Simülatörün oda
  modeli ayrık erken yansımaları zayıf üretir (RAKE'in faydası orada az görünür); bazı yöntemlerin
  alıcı ayarları benzer oda tiplerinde yapıldı, zorlu koşullardaki sonuçlar onları biraz iyi gösterebilir.

## Kaynaklar

1. M. Greenman (ZL1BPU), *MFSK16* — 16 tonlu MFSK, evrişimli kod ve serpiştirme ile amatör telsiz kipi.
2. G. Gerganov, *ggwave: tiny data-over-sound library*, <https://github.com/ggerganov/ggwave>.
3. L. Vangelista, "Frequency Shift Chirp Modulation: The LoRa Modulation," *IEEE Signal Processing
   Letters*, 24(12):1818–1821, 2017.
4. H. Lee, T. H. Kim, J. W. Choi, S. Choi, "Chirp signal-based aerial acoustic communication for
   smart devices," *IEEE INFOCOM*, 2015.
5. A. J. Viterbi, "Error bounds for convolutional codes and an asymptotically optimum decoding
   algorithm," *IEEE Trans. Information Theory*, 13(2):260–269, 1967.
6. CCSDS 131.0-B, *TM Synchronization and Channel Coding* (K = 7, oran 1/2 evrişimli kod + Reed-Solomon).
7. G. D. Forney Jr., *Concatenated Codes*, MIT Press, 1966.
8. I. S. Reed, G. Solomon, "Polynomial codes over certain finite fields," *J. SIAM*, 8(2):300–304, 1960.
9. T. R. Benedict, G. W. Bordner, "Synthesis of an optimal set of radar track-while-scan smoothing
   equations," *IRE Trans. Automatic Control*, 7(4):27–32, 1962 (alfa-beta izleyici).
10. ETSI EN 300 401, *Radio Broadcasting Systems; Digital Audio Broadcasting (DAB) to mobile,
    portable and fixed receivers* (π/4-DQPSK OFDM, zaman-frekans serpiştirme).
11. R. Nandakumar, K. K. Chintalapudi, V. Padmanabhan, R. Venkatesan, "Dhwani: Secure peer-to-peer
    acoustic NFC," *ACM SIGCOMM*, 2013.
12. L. Rizzo, "Effective erasure codes for reliable computer communication protocols," *ACM SIGCOMM
    Computer Communication Review*, 27(2):24–36, 1997.
13. IEEE Std 802.11-1997, *Wireless LAN Medium Access Control (MAC) and Physical Layer (PHY)
    Specifications*, madde 15: 2,4 GHz DSSS PHY (11 çipli Barker dizisi, 1 Mbit/sn DBPSK).
14. J. G. Proakis, M. Salehi, *Digital Communications*, 5. baskı, McGraw-Hill, 2008.
15. R. Price, P. E. Green Jr., "A communication technique for multipath channels," *Proc. IRE*,
    46(3):555–570, 1958.
16. J. J. Spilker Jr., "Delay-lock tracking of binary signals," *IEEE Trans. Space Electronics and
    Telemetry*, SET-9:1–8, 1963.
17. J. Potter, J. Alves, D. Green, G. Zappa, I. Nissen, K. McCoy, "The JANUS underwater communications
    standard," *2014 Underwater Communications and Networking (UComms)*, IEEE, 2014.
18. NATO STANAG 4748 / ANEP-87, *JANUS: Digital underwater signalling standard for network node
    discovery and interoperability*, NATO Standardization Office.
19. IEEE Std 802.11a-1999, *Part 11: Wireless LAN Medium Access Control (MAC) and Physical Layer (PHY)
    specifications: High-speed Physical Layer in the 5 GHz Band*.
20. F. Tosato, P. Bisaglia, "Simplified soft-output demapper for binary interleaved COFDM with
    application to HIPERLAN/2," *IEEE ICC*, 2:664–668, 2002.
21. J.-J. van de Beek, O. Edfors, M. Sandell, S. K. Wilson, P. O. Börjesson, "On channel estimation in
    OFDM systems," *IEEE VTC*, 2:815–819, 1995.
22. A. Batra, J. Balakrishnan, G. R. Aiello, J. R. Foerster, A. Dabak, "Design of a multiband OFDM
    system for realistic UWB channel environments," *IEEE Trans. Microwave Theory and Techniques*,
    52(9):2123–2138, 2004.
23. R. E. Kalman, "A new approach to linear filtering and prediction problems," *Trans. ASME, J. Basic
    Engineering*, 82(1):35–45, 1960.
24. S. Franke, B. Somerville, J. Taylor, "The FT4 and FT8 Communication Protocols," *QEX*,
    Temmuz/Ağustos 2020, s. 7–17.
25. K. Goba, *ft8_lib*, <https://github.com/kgoba/ft8_lib> (MIT lisansı; LDPC tabloları buradan).
26. J. P. Costas, "A study of a class of detection waveforms having nearly ideal range–Doppler ambiguity
    properties," *Proc. IEEE*, 72(8):996–1009, 1984.
27. R. G. Gallager, "Low-density parity-check codes," *IRE Trans. Information Theory*, 8(1):21–28, 1962.
28. S. J. Johnson, *Iterative Error Correction: Turbo, Low-Density Parity-Check and Repeat–Accumulate
    Codes*, Cambridge University Press, 2010.
29. L. R. Bahl, J. Cocke, F. Jelinek, J. Raviv, "Optimal decoding of linear codes for minimizing symbol
    error rate," *IEEE Trans. Information Theory*, 20(2):284–287, 1974.
30. M. Stojanovic, J. Catipovic, J. G. Proakis, "Phase-coherent digital communications for underwater
    acoustic channels," *IEEE J. Oceanic Engineering*, 19(1):100–111, 1994.
31. S. Haykin, *Adaptive Filter Theory*, 4. baskı, Prentice Hall, 2002 (üstel ağırlıklı RLS).
32. MIL-STD-188-110B, *Interoperability and Performance Standards for Data Modems*, ABD Savunma
    Bakanlığı, 2000 (tek tonlu seri modem: bilinen sonda sembolleriyle karışık veri çerçeveleri).
33. F. M. Gardner, *Phaselock Techniques*, 3. baskı, Wiley, 2005 (ikinci dereceden döngü kazançları).

## In English

Sonik is a dependency-free acoustic modem that runs in the browser: one device turns text, an image
or a file into sound, another decodes it from the microphone. It offers eight literature-based
methods that share one sync, framing and Reed–Solomon layer, so they can be compared side by side in
the same channel simulator:

- **Mod 1, MFSK** uses frequency-hopped tone sets with Reed–Solomon erasure decoding. It is the
  default.
- **Mod 2, CSS** is LoRa-style chirp spread spectrum with a K=7 convolutional code and soft-decision
  Viterbi decoding. It separates timing from Doppler using the chirp's wrap-point phase jump and
  tracks them with an alpha-beta tracker.
- **Mod 3, DQPSK-OFDM** is DAB-style OFDM with time-frequency interleaving (block hopping).
- **Mod 4, DSSS** spreads each coded bit with the 802.11 11-chip Barker code or with 31/63-chip
  segments of a PRBS-15 long code (DBPSK, RRC chips). A RAKE receiver combines up to four resolved
  echo paths with exact noncoherent LLRs, and an early–late delay-lock loop tracks clock offset and motion.
- **Mod 5, JANUS** is frequency-hopped binary FSK after the NATO JANUS underwater standard (STANAG
  4748): 13 tone pairs, one coded bit per chip, JANUS's K=9 convolutional code and a 32-chip
  preamble. Its non-coherent receiver predicts the reverberation each tone left from its previous
  use, and square-law combines the chip's own reverberant tail as extra diversity branches.
- **Mod 6, OFDM-QAM** is coherent, pilot-aided OFDM in the line of IEEE 802.11a: training symbols,
  four comb pilots, QPSK/16-QAM, the K=7 code with the 802.11a interleaver, and max-log soft
  demapping. Audio has no carrier oscillator, so the common phase error is a delay-proportional
  slope, tracked by a Kalman filter.
- **Mod 7, FT8** adapts the FT8 weak-signal protocol: Gray-coded 8-GFSK (BT = 2, h = 1) in 79-symbol
  frames with three 7×7 Costas arrays, and FT8's own LDPC(174, 91) code (tables from ft8_lib) with
  belief-propagation decoding. Symbols are scaled to 40–80 ms, 2–4 FT8 signals run side by side, and
  the receiver adds a per-tone echo model and a BCJR pass over each data block.
- **Mod 8, SC-DFE** is single-carrier coherent BPSK/QPSK (3.7–4 kBd, RRC) with the adaptive decision-
  feedback equalizer of Stojanovic, Catipovic and Proakis (1994): a fractionally spaced feedforward
  filter, a feedback filter and a second-order DPLL, jointly adapted by RLS after a training sequence.
  Known probe symbols between data blocks (as in MIL-STD-188-110) limit error propagation, and the
  DPLL's frequency state also drives symbol timing, since audio has no separate carrier oscillator.

Mod 1 is the default; Mod 2–8 are experimental. The UI offers them, and live listening decodes them,
only after you tick "Deneysel yöntemleri aç" (enable experimental methods). File decoding and the
simulator always try all methods.

The methods come in three bands (2–10 kHz, 11–17 kHz, near-ultrasonic) and several speed levels,
38 profiles in total, from 2.8 B/s to 1.3 kB/s net. In the included channel simulator, at −15 dB
in-band SNR the robust levels of CSS, DSSS, JANUS and FT8 decode every packet, while MFSK decodes 20 %.
In a far reverberant room (RT60 1.2 s, DRR −12 dB), CSS, DSSS and JANUS decode every packet, while FT8's
fixed 8-tone set suffers from echo. Long-symbol CSS loses timing when the device is shaken, whereas
MFSK, DSSS, JANUS and FT8 do not. OFDM-QAM reaches 1.3 kB/s net side by side and 648 B/s at 50 cm. All
results are from the simulator; the methods have not yet been measured on real devices.
Cross-packet Reed–Solomon parity makes image and file transfer tolerant to lost packets. While an
image is still arriving, the receiver draws it row by row from the packets heard so far (WebP streamed
into WebCodecs `ImageDecoder`). Optional
AES-GCM encryption is available. Everything stays on the device. The UI is in Turkish. Try it at
<https://sonik.perinet.org>.
