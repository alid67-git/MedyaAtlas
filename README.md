# MedyaAtlas

Windows ve Android uygulaması: fotoğraf/video GPS konumlarını dünya haritasında gösterir.

Dağıtım RideAtlas gibi olacak: GitHub **Releases** (Windows zip + Android APK). Web / GitHub Pages yok.

## Çalıştırma

- Windows: `run_windows.bat`
- Android: `run_android.bat` (USB hata ayıklama açık olmalı)

Flutter SDK: `C:\src\flutter\bin\flutter.bat`

## Ne var (0.6.5)

- Klasör / dosya taraması — foto + video + GoPro + DJI (kopyalamaz, yalnızca indeks)
- Tür filtresi yalnızca görünümü etkiler; tarama her zaman tüm medyayı ekler
- Bozuk EXIF GPS (NaN) Hive/haritayı düşürmez; tarama sırasında harita pinleri dondurulur
- Fotoğraf EXIF GPS + Orientation (düz görünüm)
- Videoda başlık ISO6709 / ©xyz; tarama sırasında gömülü/.THM önizleme JPEG
- Harita kümesi ~40 m; sağ panel önizleme cache’ten (video_player ızgarada yok)
- GoPro/DJI tıklanınca Windows oynatıcı; kapat tuşu sağda
- Sürükle-bırak klasör, Ctrl+O; konum yokları yeniden dene

GoPro GPMF telemetrisi henüz yok (GPS’siz GoPro’lar “Konum bulunamayan”da listelenir). GPX/KML ride çizgileri henüz yok.

## Eski React (PC, yerel web)

Eski tarayıcı sürümü dağıtılmaz. Bilgisayarda duruyorsa `baslat-v2.bat` ile localhost’ta açılır (ağır GoPro tarama). Kaynak: dal `archive/react`.
