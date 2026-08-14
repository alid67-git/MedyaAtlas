# MedyaAtlas

Windows ve Android uygulaması: fotoğraf/video GPS konumlarını dünya haritasında gösterir.

Dağıtım: GitHub **Releases** (Android APK; Windows zip yakında). Web / GitHub Pages yok.

## Android — GitHub’dan kur

1. Aç: https://github.com/alid67-git/MedyaAtlas/releases  
2. En son **`MedyaAtlas-*-android.apk`** indir / kur  
3. İlk taramada **Fotoğraf/Video** ve **medya konumu** izinlerini ver (Android EXIF GPS için şart)  
4. **Google Fotoğraflar bulutu taranmaz** — Dosyalar / DCIM / Kamera klasöründen seç  

Direkt APK (güncel sürüm yayınlandıkça değişir): Releases sayfasındaki son APK.

## Kurulum (Windows) — yerel disk

**Asıl klasör:** `C:\src\MedyaAtlas`  
Google Drive üzerinde geliştirme / `flutter run` yapma.

1. Bir kez: `tasi_c_src.bat` → `C:\src\MedyaAtlas` + masaüstü kısayolu **MedyaAtlas Windows**  
2. Sonra sadece o kısayol / `run_windows.bat`  
3. Drive `MedyaAtlasApp` kullanma

Elle: `kisayol_olustur.bat` · `guncelle.bat` · `temizle_build.bat` · `build_apk.bat`

Flutter SDK: `C:\src\flutter\bin\flutter.bat`

## Çalıştırma (geliştirme)

- Windows: `C:\src\MedyaAtlas\run_windows.bat`
- Android USB: `C:\src\MedyaAtlas\run_android.bat`

## Ne var (0.6.7)

- Android: `ACCESS_MEDIA_LOCATION` + tarama öncesi izin (EXIF GPS)
- GitHub Actions Android APK Release
- Klasör / dosya taraması — foto + video + GoPro + DJI
- EXIF GPS + Orientation; video başlık GPS; tarama önizleme JPEG
- GoPro/DJI tıklanınca Windows oynatıcı; kapat sağda
- Çalışma yolu (PC): `C:\src\MedyaAtlas`

GoPro GPMF telemetrisi henüz yok. GPX/KML ride çizgileri henüz yok.

## Eski React (PC, yerel web)

Eski tarayıcı sürümü dağıtılmaz. Kaynak: dal `archive/react`.
