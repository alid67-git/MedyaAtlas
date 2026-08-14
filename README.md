# MedyaAtlas

Windows ve Android uygulaması: fotoğraf/video GPS konumlarını dünya haritasında gösterir.

Dağıtım RideAtlas gibi olacak: GitHub **Releases** (Windows zip + Android APK). Web / GitHub Pages yok.

## Çalıştırma

- Windows: `run_windows.bat`
- Android: `run_android.bat` (USB hata ayıklama açık olmalı)

Flutter SDK: `C:\src\flutter\bin\flutter.bat`

## Ne var (0.6.4)

- Klasör / dosya taraması — foto + video + GoPro + DJI (kopyalamaz, yalnızca indeks)
- Tür filtresi yalnızca görünümü etkiler; tarama her zaman tüm medyayı ekler
- Bozuk EXIF GPS (NaN) Hive/haritayı düşürmez; tarama sırasında harita pinleri dondurulur
- Fotoğraf EXIF GPS, videoda başlık ISO6709 / ©xyz
- Harita kümesi ~40 m
- GPS konumlu / konum bulunamayan sayaçları, kaynaklar, tür filtresi
- Sürükle-bırak klasör, Ctrl+O
- Konum yokları yeniden dene
- GoPro / video sağ panel önizlemesi ve tam ekran oynatma (Windows; Impeller kapalı)
- Görüntüleyicide sil butonu yok (dosyaya dokunulmaz; yalnızca indeks)

GoPro GPMF telemetrisi henüz yok (GPS’siz GoPro’lar “Konum bulunamayan”da listelenir). GPX/KML ride çizgileri henüz yok. Bazı GoPro codec’leri için Windows’ta ek codec paketi gerekebilir.

## Eski React (PC, yerel web)

Eski tarayıcı sürümü dağıtılmaz. Bilgisayarda duruyorsa `baslat-v2.bat` ile localhost’ta açılır (ağır GoPro tarama). Kaynak: dal `archive/react`.
