# Sonik: sesle veri aktarımı

Tarayıcıda çalışan, bağımlılıksız bir **akustik modem**. Bir cihaz metni, görseli ya da dosyayı
sese çevirip çalar, diğeri mikrofonla dinleyip çözer. Kurulum, sunucu ya da hesap yok: ses de
içerik de hiçbir yere gönderilmez, her şey tarayıcıda işlenir.

Üç ayrı yöntem (mod) sunar; her biri literatürde yerleşik bir kipleme ailesinden gelir ve farklı
bir koşul için en iyisidir: **MFSK** (frekans kaydırma), **CSS** (LoRa tipi chirp yayılı spektrum)
ve **DQPSK-OFDM** (çok taşıyıcılı). Alıcı üçünü de aynı anda dinler, hangisinin geldiğini
kendisi tanır.

**Canlı sürüm:** <https://sonik.perinet.org>

![Sonik arayüzü: yöntem, bant ve hız seçimi; görsel Turbo ile gönderilip çözülmüş](docs/sonik.webp)

## Özellikler

- **3 yöntem, 19 profil:** her yöntemde 3 frekans bandı (Standart 2–10 kHz, Yüksek 11–17 kHz,
  Ultrasonik 17–20,5 kHz) ve hız kademeleri; net 3 B/sn'den 375 B/sn'ye.
- **Metin, görsel ve dosya:** görsel seçilen boyuta küçültülüp WebP olarak yeniden kodlanır; her
  tür dosya gönderilebilir (yayın en çok 5 dakika: Turbo ile ~80 KB). Uzun metin kendiliğinden parçalanır.
- **Sağlamlık:** Reed-Solomon (silintili), CRC-32; CSS'te ayrıca evrişimli kod ve yumuşak kararlı
  Viterbi; paketler arası eşlik parçaları ve tekrar kipi (kaçan parçalar sonraki turda tamamlanır).
- **Otomatik uyum:** profil paket başındaki chirp ve başlıktan tanınır; 44,1/48 kHz farkı, saat
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

Hangi yöntem? Uzak, gürültülü ya da çok yankılı ortamda **Mod 2 · CSS**; oda içinde birkaç
metrede **Mod 1 · MFSK**; cihazlar yakınken ve görsel/dosya için **Mod 3 · OFDM**.

İpuçları:

- Ses seviyesi %50–90 arası iyi. CSS sabit zarflıdır, yüksek seste de bozulmaz.
- Turbo için cihazları yan yana koy. CSS Sağlam'da (en uzun semboller) cihazları sabit tut.
  Yüksek ve ultrasonik bantlarda hoparlörü alıcının mikrofonuna çevir.
- Bluetooth hoparlör/kulaklık sesi sıkıştırıp tonları bozabilir. iPhone'da sessiz mod anahtarı sesi
  kapatabilir. macOS'ta Denetim Merkezi → Mikrofon Modu **Standart** olmalı ("Ses Yalıtımı" tonları siler).
- Telefonda dinlerken ekranı açık, sayfayı önde tut; arka planda tarayıcı mikrofonu durdurabilir.
- Mikrofon için sayfa HTTPS üzerinden (ya da `localhost`'tan) açılmalı.

## Yöntemler

### Mod 1 · MFSK — frekans atlamalı ton kümeleri

Her 4 bit 16 frekanstan biri olarak çalınır; profile göre aynı anda 1–4 ton. Ardışık semboller
dönüşümlü ton kümeleri kullanır: bir önceki sembolün oda yankısı, çözülen kümeye düşmez; bir kümenin
yeniden duyulmasına kadar geçen süre ("yankı yaşı") yankıya dayanıklılığı belirler. Çözme Hann
pencereli Goertzel ile; her kararın güven marjı tutulur ve şüpheli baytlar Reed-Solomon'a silinti
olarak verilir (2·hata + silinti ≤ parite). MFSK16 [1] ve ggwave [2] çizgisinde.

### Mod 2 · CSS — LoRa tipi chirp yayılı spektrum

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

### Mod 3 · DQPSK-OFDM — zaman-frekans serpiştirmeli çok taşıyıcı

Bantta 100 Hz aralıklı onlarca alt taşıyıcı birden çalar; sembol 10 ms + 3,3 ms koruma aralığı.
Her taşıyıcı bir önceki kullanımına göre faz farkıyla 2 bit (DQPSK) ya da 1 bit (DBPSK) taşır;
hoparlörün, mikrofonun ve odanın etkisi farkta düşer, kanal kestirimi gerekmez (DAB [10]; akustik
OFDM için bkz. [11]). Oda yankısı koruma aralığından çok uzun sürdüğü için taşıyıcılar bloklara
bölünür ve her sembolde tek blok çalar: bir blok, eski yankısı sönünce yeniden kullanılır. Saat
farkı ve hareket, fazda frekansla orantılı bir eğim olarak ölçülür (verinin M. kuvvetiyle modülasyon
silinip sıfırdan geçen doğruya en küçük kareler) ve her sembolde düzeltilir. MFSK'nin 5–15 katı hız;
yankı arttıkça hata artar, yakın mesafe içindir.

### Ortak katmanlar

```
│ chirp │ boşluk │ başlık (uzunluk, tür, profil) │ veri + CRC-32 │ RS parite │
  senkron          ← MFSK tonları · CSS chirp'leri · OFDM alt taşıyıcıları →
```

- **Senkron:** her paket bir chirp ile başlar; alıcı gelen sesi FFT tabanlı normalize korelasyonla
  şablonlara benzetip paket başını örnek düzeyinde bulur. Aynı bantta benzer profiller bir chirp'i
  paylaşır; hangi profil olduğu başlıktaki profil numarasından anlaşılır.
- **Başlık (sürüm 3):** 12 bit uzunluk, 8 bit profil no, şifreli ve tür bayrakları, 4 bayt RS.
- **Görsel ve dosya:** içerik K parçaya bölünür, sütun sütun Reed-Solomon ile M eşlik parçası
  üretilir (paket kayıplarına karşı silinti kodu [12]): alıcı herhangi K farklı parçayı duyunca
  içeriği kurar. Parça boyu yayın süresini en aza indirecek şekilde seçilir.
- **Güvenlik:** alınan metin DOM'a yalnız `textContent` ile yazılır. Görsel, gönderenin bildirdiği
  türe bakılmadan imzasından tanınıyorsa (PNG, JPEG, GIF, WebP) ve boyutu makulse gösterilir; diğer
  her şey yalnız indirilir, dosya adı temizlenir. Sayfa sıkı bir CSP ile sunulur. Ses bir yayındır:
  yakındaki herkes çözebilir, gizli içerik için parola kullan.

## Profiller

Net hız: kiplemenin ham hızı × evrişimli kod oranı × RS oranı (bayt/sn); paket başı yük (senkron,
başlık) hariç. Yöntemleri karşılaştırmak için ham hızdan daha dürüsttür.

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

## Karşılaştırma

Kanal simülatöründe paket başarısı (%, standart bant, hücre başına 6 deneme, kısa metin mesajları;
`npm run bench`). SNR bant içidir; DRR doğrudan sesin yankıya oranı (küçüldükçe uzak).

| Koşul | MFSK Sağlam | MFSK Normal | MFSK Hızlı | CSS Sağlam | CSS Normal | CSS Hızlı | OFDM Çok hızlı | OFDM Turbo |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| temiz | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| SNR 10 dB | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| SNR 0 dB | 100 | 100 | 100 | 100 | 100 | 100 | 50 | 0 |
| SNR −10 dB | 100 | 100 | 67 | 100 | 100 | 100 | 0 | 0 |
| SNR −15 dB | 17 | 0 | 0 | 100 | 100 | 17 | 0 | 0 |
| yan yana (RT60 0,4 s, DRR +15 dB) | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| 50 cm (RT60 0,5 s, DRR +6 dB) | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| oda (RT60 0,5 s, DRR 0 dB) | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 0 |
| uzak (RT60 0,6 s, DRR −5 dB) | 100 | 100 | 100 | 100 | 100 | 100 | 0 | 0 |
| yankılı salon (RT60 1 s, DRR −8 dB) | 100 | 100 | 0 | 100 | 83 | 100 | 0 | 0 |
| çok uzak (RT60 1,2 s, DRR −12 dB, SNR 5 dB) | 100 | 17 | 0 | 100 | 100 | 50 | 0 | 0 |
| telefon hoparlörü + oda | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 0 |
| konuşma girişimi 0 dB | 100 | 100 | 100 | 100 | 100 | 100 | 67 | 17 |
| elde titreme ±1 cm + oda | 100 | 100 | 100 | 50 | 100 | 100 | 83 | 0 |
| sallama ±3 cm + oda | 100 | 100 | 100 | 0 | 83 | 100 | 33 | 0 |
| yaklaşma 10 cm/sn + oda | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 0 |
| kırpma (8×) + oda | 100 | 100 | 100 | 100 | 100 | 100 | 0 | 0 |
| 44,1→48 kHz, +120 ppm, uzak | 100 | 100 | 100 | 100 | 100 | 100 | 0 | 0 |

Özetle: düşük SNR'de ve uzak/yankılı ortamda **CSS** (−15 dB'de CSS Normal %100, MFSK Normal %0), elde
tutma ve kırpmada **MFSK**, yakın mesafede hızda **OFDM** öne çıkıyor. CSS'in uzun sembollü Sağlam
profili sallamaya dayanmıyor; orada cihazlar sabit durmalı.

Görsel gönderme süreleri (WebP; parça ve eşlik payı dahil):

| Görsel boyutu | Turbo | Çok hızlı | Yüksek · Turbo | Ultrasonik · Turbo | MFSK Hızlı |
|---|---:|---:|---:|---:|---:|
| Küçük (160 px, ≈ 2,5 KB) | 10 sn | 27 sn | 14 sn | 19 sn | 2 dk 11 sn |
| Orta (320 px, ≈ 7 KB) | 28 sn | 69 sn | 39 sn | 51 sn | — |
| Büyük (720 px, ≈ 20 KB) | 74 sn | 3 dk 14 sn | 1 dk 48 sn | 2 dk 23 sn | — |

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
  src/mod/               mfsk.js, css.js, ofdm.js (verici + alıcı)
  src/transfer.js        görsel/dosya: parçalama, paketler arası RS, birleştirme
  src/image.js           görsel küçültme; alınan görselin imzası ve boyutu
  src/crypto.js          PBKDF2 + AES-GCM
  src/codec/             crc32, reedsolomon, conv (evrişimli kod, Viterbi, serpiştirme), framing
  src/dsp/               fft, filters, chirp, sync, store, channel
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

- OFDM profillerinde yankı arttıkça hata artar; Turbo yakın mesafe, Çok hızlı oda içi içindir.
- CSS'in uzun sembollü profillerinde (Sağlam, SF 10; ultrasonikte 91 ms) cihazı sallamak zamanlamayı
  sembolden sembole izlenemeyecek kadar değiştirir; bu profillerde cihazlar sabit durmalı.
- Yüksek ve ultrasonik bantların başarısı hoparlör ve mikrofona bağlıdır; bazı telefonlar 17 kHz
  üstünü zayıf çalar ya da kaydeder.
- Tarayıcı ya da işletim sistemi mikrofon sesini işlemeyi (yankı engelleme, gürültü bastırma)
  kapatmazsa tonlar bozulabilir; sayfa bunu algılayınca uyarır.
- Paket biçiminin 3. sürümü önceki sürümlerle uyumlu değildir; iki cihaz da aynı sürümü açmalı.
- Sonuçlar simülatör ölçümleridir; gerçek cihazlarla oda koşullarında ölçülmedi.

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

## In English

Sonik is a dependency-free acoustic modem that runs in the browser: one device turns text, an image
or a file into sound, another decodes it from the microphone. It offers three literature-based
methods:

- **Mod 1, MFSK** uses frequency-hopped tone sets with Reed–Solomon erasure decoding.
- **Mod 2, CSS** is LoRa-style chirp spread spectrum with a K=7 convolutional code and soft-decision
  Viterbi decoding. It separates timing from Doppler using the chirp's wrap-point phase jump and
  tracks them with an alpha-beta tracker.
- **Mod 3, DQPSK-OFDM** is DAB-style OFDM with time-frequency interleaving (block hopping).

Each method is available in three bands (2–10 kHz, 11–17 kHz, near-ultrasonic) and several speed
levels, 19 profiles in total. In the included channel simulator, CSS (normal level) decodes all packets
at −15 dB in-band SNR and in a far reverberant room (RT60 1.2 s, DRR −12 dB) where MFSK at a similar
rate fails. MFSK is the most tolerant of hand motion and clipping, and OFDM reaches 375 B/s net at
close range.
Cross-packet Reed–Solomon parity makes image and file transfer tolerant to lost packets. Optional
AES-GCM encryption is available. Everything stays on the device. The UI is in Turkish. Try it at
<https://sonik.perinet.org>.
