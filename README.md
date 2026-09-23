# Sonik: sesle veri aktarımı

Tarayıcıda çalışan, bağımlılıksız bir akustik modem. Bir cihaz metni sese çevirip çalar,
diğeri mikrofonla dinleyip çözer. Sunucu tarafı yok; ses ve mesaj hiçbir yere gönderilmez.

Yayın: <https://sonik.perinet.org>

## Nasıl çalışır

```
│ chirp │ boşluk │ başlık (uzunluk, sürüm) │ veri + CRC-32 │ RS parite │
  senkron          ← her sembolde 1–4 ton, her ton 4 bit (16 frekanstan biri) →
```

- **Senkron:** paket bir chirp ile başlar; alıcı FFT tabanlı normalize korelasyonla
  paket başını milisaniyenin altında bulur. Her profilin chirp'i farklıdır, profil kendiliğinden tanınır.
- **Modülasyon:** MFSK. Ardışık semboller dönüşümlü ton kümeleri kullanır; bir kümenin
  yeniden duyulmasına kadar geçen süre ("yankı yaşı") oda yankısına karşı belirleyicidir.
- **Çözme:** Hann pencereli Goertzel; her kararın güven marjı tutulur.
- **Hata düzeltme:** GF(256) Reed-Solomon. Düşük güvenli baytlar silinti olarak verilir
  (2·hata + silinti ≤ parite). CRC-32 tutmayan mesaj asla gösterilmez.
- **Şifreleme (isteğe bağlı):** PBKDF2-SHA256 → AES-256-GCM, pakete 36 bayt ekler.

| Profil | Ham hız | Bant | Kullanım |
|---|---:|---|---|
| Normal | 16,7 B/sn | 1,9–7,3 kHz | 1–3 m, yankılı oda |
| Sağlam | 5 B/sn | 1,5–3,7 kHz | uzak, gürültülü, çok yankılı |
| Hızlı | 34,5 B/sn | 1,4–9,4 kHz | ≤ 1 m |
| Ultrasonik | 8,8 B/sn | 17,3–19,8 kHz | neredeyse duyulmaz; cihaza bağlı |

## Geliştirme

```sh
npm test                 # birim + uçtan uca testler (Node, tarayıcısız)
npm run bench            # kanal koşullarına göre başarı oranı tablosu
npm run serve            # http://localhost:8000 (localhost güvenli bağlamdır, mikrofon çalışır)

node tools/encode.js "mesaj" cikti.wav --profil hizli [--parola …]
node tools/decode.js kayit.wav [--parola …]
```

Kanal simülatörü (`public/src/dsp/channel.js`) hoparlör tepkisi, oda yankısı (RT60, DRR),
44,1↔48 kHz farkı, saat kayması/Doppler, gürültü ve konuşma girişimini taklit eder.

## Dosyalar

```
public/                  yalnız bu klasör yayınlanır
  index.html, style.css
  src/main.js            arayüz
  src/profiles.js        tüm modem parametreleri
  src/modem.js           verici: bayt → sembol → dalga formu
  src/receiver.js        alıcı: senkron adayları → paket çözücüler
  src/receiver-worker.js çözme işi (Web Worker)
  src/codec/             crc32, reedsolomon, framing
  src/dsp/               fft, filters, chirp, sync, store, channel
  src/audio/             capture-worklet (AudioWorklet), wav
  src/ui/spectrogram.js
test/                    node --test; bench.js
tools/                   encode, decode, deploy
docker-compose.yml, nginx.conf
```

## Yayın

`sonik-web` (nginx:alpine) konteyneri `npm-net` ağında `public/` klasörünü salt okunur sunar;
önünde Nginx Proxy Manager (Let's Encrypt, Force SSL) ve Cloudflare var. Dosyayı değiştirmek
yeterli, derleme yok. `nginx.conf` önbelleği ETag ile doğrular ve sıkı bir CSP uygular.

```sh
docker compose up -d
node tools/deploy.mjs --env /yol/gizli.env   # DNS + sertifika + proxy host (tekrar çalıştırmak güvenli)
```
