# MedyaAtlas

Windows ve Android uygulaması: fotoğraf/video GPS konumlarını dünya haritasında gösterir.

Dağıtım RideAtlas gibi olacak: GitHub **Releases** (Windows zip + Android APK). Web / GitHub Pages yok.

## Kurulum (Windows) — yerel disk

**Asıl klasör:** `C:\src\MedyaAtlas`  
Google Drive üzerinde geliştirme / `flutter run` yapma (symlink + eski dosya geri yazma).

1. Bir kez (Drive kopyandan da olur): `tasi_c_src.bat`  
   - `C:\src\MedyaAtlas` oluşturur / günceller  
   - Masaüstü + Başlat Menüsü kısayolu: **MedyaAtlas Windows**
2. Bundan sonra sadece o kısayolu veya `C:\src\MedyaAtlas\run_windows.bat` kullan.
3. Drive’daki eski `MedyaAtlasApp` klasörünü kullanma; arşivle veya sil.

Elle kısayol: `kisayol_olustur.bat`  
Sadece kod çek: `guncelle.bat`

Flutter SDK: `C:\src\flutter\bin\flutter.bat`

## Çalıştırma

- Windows: `C:\src\MedyaAtlas\run_windows.bat` (veya masaüstü kısayolu)
- Android: `C:\src\MedyaAtlas\run_android.bat` (USB hata ayıklama açık olmalı)

## Ne var (0.6.5)

- Klasör / dosya taraması — foto + video + GoPro + DJI (kopyalamaz, yalnızca indeks)
- Tür filtresi yalnızca görünümü etkiler; tarama her zaman tüm medyayı ekler
- Bozuk EXIF GPS (NaN) Hive/haritayı düşürmez; tarama sırasında harita pinleri dondurulur
- Fotoğraf EXIF GPS + Orientation (düz görünüm)
- Videoda başlık ISO6709 / ©xyz; tarama sırasında gömülü/.THM önizleme JPEG
- Harita kümesi ~40 m; sağ panel önizleme cache’ten
- GoPro/DJI tıklanınca Windows oynatıcı; kapat tuşu sağda
- Sürükle-bırak klasör, Ctrl+O; konum yokları yeniden dene
- Çalışma yolu: `C:\src\MedyaAtlas` (Drive dışı)

GoPro GPMF telemetrisi henüz yok (GPS’siz GoPro’lar “Konum bulunamayan”da listelenir). GPX/KML ride çizgileri henüz yok.

## Eski React (PC, yerel web)

Eski tarayıcı sürümü dağıtılmaz. Bilgisayarda duruyorsa `baslat-v2.bat` ile localhost’ta açılır (ağır GoPro tarama). Kaynak: dal `archive/react`.
