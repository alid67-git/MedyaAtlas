# MedyaAtlas

Windows ve Android uygulaması: fotoğraf/video GPS konumlarını dünya haritasında gösterir.

Dağıtım: GitHub **Releases** (Android APK; Windows zip yakında). Web / GitHub Pages yok.

## Android — GitHub’dan kur

1. Aç: https://github.com/alid67-git/MedyaAtlas/releases  
2. En son sürümde **`MedyaAtlas-*-android.apk`** indir  
3. Telefonda kur (bilinmeyen uygulamalara izin)  
4. Uygulamada klasör / medya seç → GPS’li dosyalar haritada

İlk APK yoksa: GitHub → **Actions** → **Release Android APK** → **Run workflow**  
veya PC’de `build_apk.bat` / etiket: `git tag v0.6.6 && git push origin v0.6.6`

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

## Ne var (0.6.6)

- Klasör / dosya taraması — foto + video + GoPro + DJI (kopyalamaz)
- GitHub Actions ile Android APK Release
- EXIF GPS + Orientation; video başlık GPS; tarama sırasında video önizleme JPEG
- GoPro/DJI tıklanınca Windows oynatıcı; kapat sağda
- Çalışma yolu: `C:\src\MedyaAtlas`

GoPro GPMF telemetrisi henüz yok. GPX/KML ride çizgileri henüz yok.

## Eski React (PC, yerel web)

Eski tarayıcı sürümü dağıtılmaz. Kaynak: dal `archive/react`.
