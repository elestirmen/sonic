# Ekran/kamera aktarımı araştırması

2 Ekim 2026'da, Sonik'e ayrı bir görsel aktarım bölümü eklemeden önce aşağıdaki birincil
kaynaklar incelendi. Başka projelerin performans iddiaları Sonik'in ölçümü olarak kullanılmadı.

| Kaynak | İlgili yaklaşım | Sonik'te alınan karar |
| --- | --- | --- |
| [QR-Stream](https://github.com/ProfessorQuantumUniverse/QR-Stream) | Ekranda QR yayını, kamera alımı; sistematik ilk tur, LT/XOR kurtarma, yayın kimliği ve CRC. | İlk parçaları doğrudan göster; kaçan parçalar için yeni kurtarma kareleri üret. |
| [Decimen](https://github.com/aryanjsx/Decimen) | Tarayıcıdan tarayıcıya dosya; fountain kodları, dosya bilgisi, isteğe bağlı sıkıştırma ve SHA denetimi. | Dosya adı ve MIME bilgisini koru; mevcut Sonik gövde biçimini ve isteğe bağlı AES-GCM şifrelemesini kullan. |
| [Blockchain Commons Animated QR / UR](https://developer.blockchaincommons.com/animated-qrs/) | Çok parçalı, fountain kodlu animasyon; eksik kareler ve geç katılan alıcı. | Alıcının baştan izleme zorunluluğunu kaldır; UR yerine bağımsız Sonik çerçevesi kullan. |

GPL/AGPL lisanslı uygulamaların kaynak kodu kopyalanmadı. Sonik'in protokolü yeniden yazıldı.
QR üretimi [Project Nayuki](https://www.nayuki.io/page/qr-code-generator-library) (MIT), pikselden
okuma [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0) ile yapılır. Sabit kaynak sürümü/özeti,
değişiklikler ve lisanslar [vendor notlarında](../public/src/vendor/README.md) bulunur.
Kamera erişimi [Media Capture and Streams](https://w3c.github.io/mediacapture-main/) API'sini
kullanır; HTTPS ve kullanıcı izni gerekir.

## Uygulanan protokol: sürüm 1

Her standart QR, metin kodlamasına çevrilmeden bir ikili çerçeve taşır. Ağ, sunucu oturumu
ve cihazlar arasında geri bildirim bağlantısı gerekmez. Alıcı tamamlandığını yerel olarak
gösterir; gönderici yayını elle durdurur.

| Alan | Bayt |
| --- | ---: |
| `SONIK`, sürüm, şifreleme bayrağı | 7 |
| Rastgele aktarım kimliği | 8 |
| Toplam gövde uzunluğu | 4 |
| Parça boyu, parça sayısı | 2 + 2 |
| Kare sırası / kurtarma tohumu | 4 |
| Tam gövdenin CRC-32 değeri | 4 |
| Sabit boyutlu parça | 192 / 384 / 512 |
| Çerçevenin CRC-32 değeri | 4 |

Çok baytlı sayılar big-endian'dır. Son parça sıfırlarla tamamlanır. İlk K kare doğrudan veri
parçalarıdır. Sonraki kareler, tohumdan belirlenen parçaların XOR'udur; derece dağılımı robust
soliton temellidir ve en çok 64 parça içerir. Her dört kurtarma karesinden biri tek parça
taşır. Alıcı çözdüğü parçaları bağlı denklemlerden çıkararak ilerler. Bekleyen denklemler,
tekrar kayıtları, uzunluk ve parça boyu sınırlandırılmıştır; farklı yayınlar karıştırılmaz.

CRC, rastlantısal bozulmayı tespit eder. İsteğe bağlı parolada Sonik'in PBKDF2-SHA256 ve
AES-256-GCM uygulaması aynı gövdeyi şifreler. Dosya sıkıştırma eklenmedi. Gövde en çok 4 MB
kullanıcı verisi ve dosya/şifreleme başlığını taşır. QR yoğunlukları ECC-M kullanır; otomatik
maske seçilir. Yayın aralığı seçilen 3/6/10 kare/sn'ye göre ayarlanır; yoğunluk değişikliği
yeni yayın gerektirir. Kamera okuması 960 piksele kadar ölçeklenir ve Worker'da çözülür.

## Doğrulama

`test/visual.test.js` metin/dosya ve şifreleme dönüşlerini, farklı sırayı, tekrarları, yayın
ayrımını, bozuk kareleri ve sınırları denetler. Başlangıcı kaçırıp karelerin yarısını kaybeden
alıcı, kurtarma kareleriyle tamamlanır; 4 MB sınırı da yalnız kurtarma kareleriyle denenir.
Nayuki'nin ürettiği gerçek QR pikselleri bağımsız jsQR ile üç yoğunlukta, dönmüş ve kontrastı
azalmış görüntülerde çözülür. Dosya, eksik QR görüntülerinden uçtan uca yeniden kurulur.

Chromium'da iki ayrı sayfa arasında üretilmiş QR görüntüsünü kamera akışına veren bir tarayıcı
denemesiyle metin, dosya ve raster önizleme doğrulandı. Şifreli dosyanın baytları indirilip
karşılaştırıldı; yanlış paroladan sonra yeniden taramadan açma, kamera izni hatası sonrası
yeniden deneme, kamera kapatma, Worker hatası sonrası yeniden başlatma, tam ekran ve mobil
koyu tema görünümü de denendi. Kamera görüntüsü bu doğrulamada yapaydır.

Canlı HTTPS sitesinde kamera Permissions-Policy'si, CSP altında modül/Worker yüklemesi ve
tarayıcının yapay aygıtıyla gerçek getUserMedia akışı doğrulandı. Kamerayı kapatınca parçaların
korunması, yeniden açılınca yalnız kurtarma karelerinden tamamlanması ve başka bir yayın
görüldüğünde kullanıcıya sıfırlama seçeneğinin bildirilmesi de denendi.

Fiziksel ekran/kamera çiftleriyle saha ölçümü yapılmadı. Bu testler hareket, parlamalar,
odaklama veya her mobil tarayıcıda aynı aktarım hızını garanti etmez.
