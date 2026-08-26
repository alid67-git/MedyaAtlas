# MedyaAtlas

Windows, Android ve **web** (iPhone Safari / Ana Ekrana Ekle): fotoğraf/video GPS konumlarını dünya haritasında gösterir.

Dağıtım: GitHub **Releases** (APK / Windows zip). Web derlemesi: `flutter build web`.

## İndirme (sabit dosya adları)

- **Android:** https://github.com/alid67-git/MedyaAtlas/releases/download/android-latest/MedyaAtlas.apk  
- **Windows:** https://github.com/alid67-git/MedyaAtlas/releases/download/windows-latest/MedyaAtlas-windows.zip  

Dosya adında ve indirme URL’sinde sürüm numarası yok; her release aynı isimle (`android-latest` / `windows-latest`) üzerine yazılır.

## iPhone (web)

Sabit adres (sürüm yok): https://alid67-git.github.io/MedyaAtlas/  

Safari’de açıp **Paylaş → Ana Ekrana Ekle**. Klasör tarama (5TB disk kökü) web’de yok; **foto/video seçici** ile medya eklenir. Tam SD/HDD kök tarama için Android veya Windows uygulaması gerekir.

## Uygulama içi güncelleme

Play Store yok. Uygulama **GitHub Releases**’e bakarak yeni sürüm bildirir ve indirir:

- Açılışta otomatik kontrol → “Güncelleme var” diyaloğu  
- Elle: üst çubuktaki güncelleme ikonu  
- Android: `MedyaAtlas.apk` indirilir, kurulum ekranı açılır  
- Windows: `MedyaAtlas-windows.zip` indirilip açılır; uygulamayı kapatıp yeni `medyaatlas.exe` çalıştırın  
- Web: uygulama içi güncelleme yok (sayfayı yenileyin)

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
- Web: `flutter run -d chrome` veya `flutter build web`

## Ne var (1.0.9)

- Tarama durumu altta çerçeveli kutu; **İptal** satırın sağında
- Büyük harici disk: DCIM / GoPro / DJI önce; GoPro GPMF + DJI SRT/GPS toplu taramada
- iPhone web: dosya seçici + harita (sınırlı)
- TR / EN / DE; harita türleri; sabit APK imzası

GPX/KML ride çizgileri henüz yok.

## Eski React (PC, yerel web)

Eski tarayıcı sürümü dağıtılmaz. Kaynak: dal `archive/react`.
