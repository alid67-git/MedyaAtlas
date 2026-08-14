# MedyaAtlas

Windows ve Android uygulaması: fotoğraf/video GPS konumlarını dünya haritasında gösterir.

Dağıtım: GitHub **Releases**. Web / GitHub Pages yok.

## İndirme (sabit dosya adları)

- **Android:** https://github.com/alid67-git/MedyaAtlas/releases/latest/download/MedyaAtlas.apk  
- **Windows:** https://github.com/alid67-git/MedyaAtlas/releases/latest/download/MedyaAtlas-windows.zip  

Dosya adında sürüm numarası yok; her release aynı isimle yayınlanır.

### Android güncelleme
- Açılışta yeni sürüm kontrolü → Güncelle (ilerleme diyaloğu)
- Elle: üst çubuktaki güncelleme ikonu
- Google Drive: [GOOGLE_DRIVE.md](GOOGLE_DRIVE.md)

### Windows güncelleme
- Zip’i indirip klasörü açın → `medyaatlas.exe`
- Geliştirme: `guncelle.bat` / `run_windows.bat` (git ile `C:\src\MedyaAtlas`)

## Kurulum (Windows) — yerel disk

**Asıl klasör:** `C:\src\MedyaAtlas`  
Google Drive üzerinde geliştirme / `flutter run` yapma.

1. Bir kez: `tasi_c_src.bat` → `C:\src\MedyaAtlas` + masaüstü kısayolu **MedyaAtlas Windows**  
2. Sonra sadece o kısayol / `run_windows.bat`  
3. Drive `MedyaAtlasApp` kullanma

Elle: `kisayol_olustur.bat` · `guncelle.bat` · `temizle_build.bat` · `build_apk.bat` · `build_windows.bat`

Flutter SDK: `C:\src\flutter\bin\flutter.bat`

## Çalıştırma (geliştirme)

- Windows: `C:\src\MedyaAtlas\run_windows.bat`
- Android USB: `C:\src\MedyaAtlas\run_android.bat`

## Ne var (0.7.1)

- Sabit APK `MedyaAtlas.apk` + sabit Windows zip `MedyaAtlas-windows.zip`
- Android uygulama içi otomatik güncelleme (ilerleme + kurulum izni)
- MedyaAtlas ikonu; Google Drive; Android EXIF medya konum izni
- PC: `C:\src\MedyaAtlas`

GoPro GPMF telemetrisi henüz yok. GPX/KML ride çizgileri henüz yok.

## Eski React (PC, yerel web)

Eski tarayıcı sürümü dağıtılmaz. Kaynak: dal `archive/react`.
