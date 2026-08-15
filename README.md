# MedyaAtlas

Windows ve Android uygulaması: fotoğraf/video GPS konumlarını dünya haritasında gösterir.

Dağıtım: GitHub **Releases**. Web / GitHub Pages yok.

## İndirme (sabit dosya adları)

- **Android:** https://github.com/alid67-git/MedyaAtlas/releases/latest/download/MedyaAtlas.apk  
- **Windows:** https://github.com/alid67-git/MedyaAtlas/releases/latest/download/MedyaAtlas-windows.zip  

Dosya adında sürüm numarası yok; her release aynı isimle yayınlanır.

## Uygulama içi güncelleme

Play Store yok. Uygulama **GitHub Releases**’e bakarak yeni sürüm bildirir ve indirir:

- Açılışta otomatik kontrol → “Güncelleme var” diyaloğu  
- Elle: üst çubuktaki güncelleme ikonu  
- Android: `MedyaAtlas.apk` indirilir, kurulum ekranı açılır  
- Windows: `MedyaAtlas-windows.zip` indirilip açılır; uygulamayı kapatıp yeni `medyaatlas.exe` çalıştırın  

Geliştirme (Windows kaynak): `guncelle.bat` / `run_windows.bat` hâlâ `C:\src\MedyaAtlas`’a git çeker.

Google Drive: [GOOGLE_DRIVE.md](GOOGLE_DRIVE.md)

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

## Ne var (0.7.9)

- Harita odaklı ana ekran: kaynak / GPS / konum yok ikon menüleri
- Güncelleme tuşu yok — açılışta otomatik kontrol + onayla indir
- Sabit APK imzası; telefon tarama GPS; `…/latest/download/MedyaAtlas.apk`
- Google Drive; EXIF medya konum izni
- PC: `C:\src\MedyaAtlas`

GoPro GPMF telemetrisi henüz yok. GPX/KML ride çizgileri henüz yok.

## Eski React (PC, yerel web)

Eski tarayıcı sürümü dağıtılmaz. Kaynak: dal `archive/react`.
