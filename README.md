# MedyaAtlas

Windows ve Android uygulaması: fotoğraf/video GPS konumlarını dünya haritasında gösterir.

Dağıtım: GitHub **Releases** (Android APK; Windows zip yakında). Web / GitHub Pages yok.

## Android — GitHub’dan kur / güncelle

**Sabit indirme linki** (dosya adı sürüm içermez):  
https://github.com/alid67-git/MedyaAtlas/releases/latest/download/MedyaAtlas.apk

- Uygulama açılışta yeni sürümü kontrol eder → Güncelle  
- Elle: üst çubuktaki güncelleme ikonu  
- Google Drive: [GOOGLE_DRIVE.md](GOOGLE_DRIVE.md)  

Eski sürümü kaldırıp yeniden kurmak şart değil; üzerine kurulum olur.

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

## Ne var (0.7.0)

- Sabit APK adı `MedyaAtlas.apk` + uygulama içi otomatik güncelleme
- MedyaAtlas ikonu; Google Drive; Android EXIF medya konum izni
- PC: `C:\src\MedyaAtlas`

GoPro GPMF telemetrisi henüz yok. GPX/KML ride çizgileri henüz yok.

## Eski React (PC, yerel web)

Eski tarayıcı sürümü dağıtılmaz. Kaynak: dal `archive/react`.
