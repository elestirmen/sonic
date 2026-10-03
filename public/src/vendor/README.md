# Yerel QR kütüphaneleri

Sonik kendi aktarım protokolünü kullanır. Bu iki kütüphane yalnız standart QR
karelerini üretir ve kamera görüntüsünden okur; ağ isteği yapmazlar.

- `qrcodegen.js`: Project Nayuki, MIT; lisans dosyanın başındadır.
  Kaynak: https://www.nayuki.io/res/qr-code-generator-library/qrcodegen.js
  Kaynak SHA-256: 2511bc17f40a3c41d4a0578995db956b38997334d3d20113a5d4dc5c49c69480
  Değişiklik: dosyanın sonuna `QrCode` ve `QrSegment` ES modülü dışa aktarımı eklendi.
- `jsqr.js`: jsQR, Apache-2.0; tam lisans `jsqr.LICENSE` içindedir.
  Kaynak: https://github.com/cozmo/jsQR/blob/8e6a036beafa7053dd44b1b76ac578d22b1b3311/dist/jsQR.js
  Kaynak SHA-256: 3325b0888fa4745c4e6940897d8c4f426fbaae76901fcbfe1871a04e90a51655
  Değişiklik: UMD sarmalı ES modülü dışa aktarımıyla değiştirildi.

Kodlar 2 Ekim 2026'da bu kaynaklardan alındı. Kurulum, paket indirme veya CDN
gerekmez. GPL/AGPL lisanslı araştırma projelerinden uygulama kodu alınmadı.
