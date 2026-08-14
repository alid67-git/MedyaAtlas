# MedyaAtlas

Windows ve Android uygulaması: fotoğraf/video GPS konumlarını dünya haritasında gösterir.

Dağıtım RideAtlas gibi olacak: GitHub **Releases** (Windows zip + Android APK). Web / GitHub Pages yok.

## Çalıştırma

- Windows: `run_windows.bat`
- Android: `run_android.bat` (USB hata ayıklama açık olmalı)

Flutter SDK: `C:\src\flutter\bin\flutter.bat`

## Ne var (0.6)

- Klasör / dosya taraması — dosya kopyalanmaz, yalnızca indeks
- Fotoğraf EXIF GPS, videoda başlık ISO6709 / ©xyz
- Harita kümesi ~40 m
- GPS konumlu / konum bulunamayan sayaçları, kaynaklar, tür filtresi
- Sürükle-bırak klasör, Ctrl+O
- Konum yokları yeniden dene

GoPro GPMF ve GPX/KML ride çizgileri henüz yok.

## Eski React (PC, yerel web)

Eski tarayıcı sürümü dağıtılmaz. Bilgisayarda duruyorsa `baslat-v2.bat` ile localhost’ta açılır (ağır GoPro tarama). Kaynak: dal `archive/react`.
