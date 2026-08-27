import 'app_settings.dart';

/// Büyük sürüm notları (küçük ayar / hata düzeltmeleri tek satırda toplanır).
class VersionHistoryEntry {
  const VersionHistoryEntry({
    required this.version,
    required this.tr,
    required this.en,
    required this.de,
  });

  final String version;
  final String tr;
  final String en;
  final String de;

  String text(AppLang lang) => switch (lang) {
        AppLang.tr => tr,
        AppLang.en => en,
        AppLang.de => de,
      };
}

const versionHistory = <VersionHistoryEntry>[
  VersionHistoryEntry(
    version: '1.0.41',
    tr: 'GPS yeniden dene: denenmişleri atlar (ANR yok); yeniden tara yalnızca yenileri; zorunlu güncelleme kapalı.',
    en: 'GPS retry skips already-tried (no ANR); rescan only new files; force-update off.',
    de: 'GPS-Retry überspringt schon Geprüfte (kein ANR); Neu-Scan nur neue Dateien; Zwangsupdate aus.',
  ),
  VersionHistoryEntry(
    version: '1.0.40',
    tr: 'Uzantısız Drive GPX’leri tanır (iPhone+Android); içerikten parse.',
    en: 'Recognizes extensionless Drive GPX (iPhone+Android); parse by content.',
    de: 'Erkennt GPX ohne Endung (Drive) auf iPhone+Android; Inhalt-Parse.',
  ),
  VersionHistoryEntry(
    version: '1.0.39',
    tr: 'GPX: Galeri değil Dosyalar; Android/iPhone medya butonları ayrıldı; net hata metni.',
    en: 'GPX: Files not Gallery; Android/iPhone media buttons split; clearer errors.',
    de: 'GPX: Dateien statt Galerie; Android/iPhone-Medien getrennt; klare Fehler.',
  ),
  VersionHistoryEntry(
    version: '1.0.38',
    tr: 'İzler menüsü: çoklu seçim (biri/hepsi); büyük GPX okuma + doğru hata mesajı.',
    en: 'Tracks menu: multi-select (one/all); large GPX read + honest error messages.',
    de: 'Spur-Menü: Mehrfachauswahl; große GPX-Dateien + klare Fehlermeldungen.',
  ),
  VersionHistoryEntry(
    version: '1.0.37',
    tr: 'Güncelleme ekranı: tam ekran büyük yüzde (RideAtlas/GPX tarzı).',
    en: 'Update screen: full-screen large percent (RideAtlas/GPX style).',
    de: 'Update-Bildschirm: großer Prozentwert im Vollbild (RideAtlas/GPX-Stil).',
  ),
  VersionHistoryEntry(
    version: '1.0.36',
    tr: 'Tek tuş güncelleme: ara sürüm yok, doğrudan en son APK; indirmede yüzde gösterilir.',
    en: 'One-tap update: jump straight to latest APK (no intermediate versions); download shows %.',
    de: 'Ein-Tipp-Update: direkt neueste APK (keine Zwischenversionen); Download zeigt %.',
  ),
  VersionHistoryEntry(
    version: '1.0.35',
    tr: 'Sabit indirme: android-latest/MedyaAtlas.apk; web aynı adrese yazılır (sürüm klasörü yok).',
    en: 'Stable download: android-latest/MedyaAtlas.apk; web overwrites same URL (no version folders).',
    de: 'Fester Download: android-latest/MedyaAtlas.apk; Web überschreibt dieselbe URL.',
  ),
  VersionHistoryEntry(
    version: '1.0.34',
    tr: 'GPX seçicide yalnızca Dosyalar (galeri/kamera yok); web videolar uygulama içinde oynar.',
    en: 'GPX picker shows Files only (no gallery/camera); web videos play in-app.',
    de: 'GPX-Auswahl nur Dateien (keine Galerie/Kamera); Web-Videos in der App.',
  ),
  VersionHistoryEntry(
    version: '1.0.33',
    tr: 'GPX/KML seçici düzeltmesi (özellikle iPhone Safari); dosya filtresi engeli kaldırıldı.',
    en: 'GPX/KML picker fix (esp. iPhone Safari); no longer blocked by file filters.',
    de: 'GPX/KML-Auswahl korrigiert (bes. iPhone Safari); Dateifilter blockiert nicht mehr.',
  ),
  VersionHistoryEntry(
    version: '1.0.32',
    tr: 'GPX/KML/KMZ iz yükleme; kaynaklar: Klasör, Galeri, Tüm telefon, Google Drive.',
    en: 'GPX/KML/KMZ track import; sources: Folder, Gallery, Whole phone, Google Drive.',
    de: 'GPX/KML/KMZ-Track-Import; Quellen: Ordner, Galerie, Ganzes Telefon, Google Drive.',
  ),
  VersionHistoryEntry(
    version: '1.0.31',
    tr: 'Kaynaklar sade: Klasör/Galeri/Telefon; her kaynakta «yeniden tara».',
    en: 'Sources simplified: Folder/Gallery/Phone; sync on each source to rescan.',
    de: 'Quellen vereinfacht: Ordner/Galerie/Telefon; Sync pro Quelle zum erneuten Scannen.',
  ),
  VersionHistoryEntry(
    version: '1.0.30',
    tr: 'Güncelleme döngüsü: uygulama artık cache dışı /r/1.0.30/ yolundan açılır (28↔29 takılması).',
    en: 'Update loop fix: app opens from cache-bust path /r/1.0.30/ (stops 28↔29 bounce).',
    de: 'Update-Schleife: App startet über Cache-freien Pfad /r/1.0.30/.',
  ),
  VersionHistoryEntry(
    version: '1.0.29',
    tr: 'iPhone güncelleme takılması: go.html temiz giriş; Ana Ekran ikonunu silip Safari’den go.html açın.',
    en: 'iPhone update stuck: clean go.html entry; delete Home Screen icon and open go.html in Safari.',
    de: 'iPhone-Update hängt: sauberer go.html-Einstieg; Home-Screen-Icon löschen und go.html in Safari öffnen.',
  ),
  VersionHistoryEntry(
    version: '1.0.28',
    tr: 'Zorunlu güncelleme iPhone’da gerçekten yeniler: SW/cache temizlenir, eski main.dart.js takılmaz.',
    en: 'Forced update really refreshes on iPhone: clears SW/cache so old main.dart.js cannot stick.',
    de: 'Zwangsupdate aktualisiert auf iPhone wirklich: SW/Cache wird geleert, altes main.dart.js bleibt nicht hängen.',
  ),
  VersionHistoryEntry(
    version: '1.0.27',
    tr: 'Web güncelleme: canlı version.json da kontrol edilir (yalnızca Pages deploy yetmez diye uyarı kaçmasın).',
    en: 'Web updates: also checks live version.json so a Pages-only deploy still prompts.',
    de: 'Web-Updates: prüft auch live version.json, damit Pages-Deploy allein warnt.',
  ),
  VersionHistoryEntry(
    version: '1.0.26',
    tr: 'Ölü blob URL yok: sekmeyi kapatınca kırık ikon yerine «yeniden seçin»; blob indeksine yazılmaz.',
    en: 'No dead blob URLs: after closing the tab you get “reselect”, not a broken icon; blobs stay out of the index.',
    de: 'Keine toten Blob-URLs: nach Tab-Schließung „erneut auswählen“ statt kaputtem Icon; Blobs nicht im Index.',
  ),
  VersionHistoryEntry(
    version: '1.0.25',
    tr: 'Büyük kütüphanede Galeri\'den ekleme artık yavaşlamıyor.',
    en: 'Adding from Gallery no longer slows down as your library grows.',
    de: 'Hinzufügen aus der Galerie wird bei großer Bibliothek nicht mehr langsam.',
  ),
  VersionHistoryEntry(
    version: '1.0.24',
    tr: '«Yeniden dene» artık web/iPhone’da da çalışıyor — dosya seçim oturumundan GPS okur.',
    en: '“Retry” now works on web/iPhone too — reads GPS from the in-session file.',
    de: '„Erneut versuchen“ funktioniert jetzt auch im Web/iPhone — liest GPS aus der Sitzungsdatei.',
  ),
  VersionHistoryEntry(
    version: '1.0.23',
    tr: 'Web video: yavaş uygulama içi player yok — doğrudan Safari’de açılır.',
    en: 'Web video: skip slow in-app player — opens in Safari immediately.',
    de: 'Web-Video: kein langsamer In-App-Player — sofort in Safari.',
  ),
  VersionHistoryEntry(
    version: '1.0.22',
    tr: 'Web video seçimi: OK sonrası dosya okunmaz; blob/GPS/önizleme ertelenir.',
    en: 'Web video pick: no file reads after OK; blob/GPS/preview deferred.',
    de: 'Web-Video: nach OK keine Dateilesung; Blob/GPS/Vorschau später.',
  ),
  VersionHistoryEntry(
    version: '1.0.21',
    tr: 'Tek video OK sonrası bekleme yok; «kopyalanmadı» yazısı kaldırıldı.',
    en: 'No wait after OK for a single video; removed “not copied” status text.',
    de: 'Kein Warten nach OK bei einem Video; „nicht kopiert“-Text entfernt.',
  ),
  VersionHistoryEntry(
    version: '1.0.20',
    tr: 'Web: OK sonrası anında ekle; GPS arka planda (bekleme yok).',
    en: 'Web: add instantly after OK; GPS in background (no long wait).',
    de: 'Web: sofort nach OK hinzufügen; GPS im Hintergrund.',
  ),
  VersionHistoryEntry(
    version: '1.0.19',
    tr: 'Dosya kopyası yok: yalnızca indeks; eski Hive medya kopyaları silindi.',
    en: 'No file copies: index only; cleared old Hive media copies.',
    de: 'Keine Dateikopien: nur Index; alte Hive-Medienkopien gelöscht.',
  ),
  VersionHistoryEntry(
    version: '1.0.18',
    tr: 'Web: çoklu seçim donması azaltıldı; HEIC önizleme; GoPro HEVC için Safari’de aç.',
    en: 'Web: faster multi-select; HEIC thumbs; open GoPro HEVC in Safari.',
    de: 'Web: schnellere Mehrfachauswahl; HEIC-Vorschau; GoPro-HEVC in Safari.',
  ),
  VersionHistoryEntry(
    version: '1.0.17',
    tr: 'GPS’siz medya listesi üst çubuğun arkasında kalmıyor; başlık altında açık liste.',
    en: 'No-GPS media list no longer hides behind the top bar; clear list below header.',
    de: 'Medien ohne GPS nicht mehr hinter der Leiste; klare Liste unter dem Header.',
  ),
  VersionHistoryEntry(
    version: '1.0.16',
    tr: 'iPhone: Favori/galeri seçimi Safari’de içeri alınır; Seç→işaretle→Ekle (video oynatmadan).',
    en: 'iPhone: Favorites/gallery selection imports on Safari; Select→tap→Add (no video play).',
    de: 'iPhone: Favoriten/Galerie-Auswahl in Safari; Auswählen→tippen→Hinzufügen.',
  ),
  VersionHistoryEntry(
    version: '1.0.15',
    tr: 'iPhone web: önizleme, foto/video oynatma ve GPS okuma (blob + Hive bayt).',
    en: 'iPhone web: preview, photo/video playback and GPS (blob + Hive bytes).',
    de: 'iPhone-Web: Vorschau, Foto/Video-Wiedergabe und GPS (Blob + Hive).',
  ),
  VersionHistoryEntry(
    version: '1.0.14',
    tr: 'Favoriler (tümü) Android/iOS uygulamasında; web’de çoklu seçim rehberi.',
    en: 'Add all Favorites on Android/iOS app; guided multi-select on web.',
    de: 'Alle Favoriten in der Android/iOS-App; Mehrfachauswahl-Hilfe im Web.',
  ),
  VersionHistoryEntry(
    version: '1.0.13',
    tr: 'Haritada ısı lekesi; tıklanınca dairesel foto pin + tarihe göre medya paneli.',
    en: 'Heat blobs on the map; tap shows circular photo pin + date-grouped media panel.',
    de: 'Heat-Blobs auf der Karte; Tippen zeigt Foto-Pin + nach Datum gruppierte Medien.',
  ),
  VersionHistoryEntry(
    version: '1.0.12',
    tr: 'Ana Ekrana/Desktop’a Ekle için kök apple-touch-icon (eski Flutter ikonu kalkar).',
    en: 'Root apple-touch-icon for Add to Home/Desktop (removes old Flutter icon).',
    de: 'Root-apple-touch-icon für „Zum Home/Desktop“ (altes Flutter-Icon weg).',
  ),
  VersionHistoryEntry(
    version: '1.0.11',
    tr: 'MedyaAtlas marka ikonu (web/iPhone); web’de güncelleme kontrolü + sayfa yenileme.',
    en: 'MedyaAtlas brand icons for web/iPhone; web update check + page reload.',
    de: 'MedyaAtlas-Markensymbol für Web/iPhone; Web-Updateprüfung + Seitenreload.',
  ),
  VersionHistoryEntry(
    version: '1.0.10',
    tr: 'iPhone web önbelleği temizlendi; GitHub Pages’te güncel Flutter sürümü.',
    en: 'Cleared iPhone web cache; GitHub Pages serves the current Flutter build.',
    de: 'iPhone-Web-Cache geleert; GitHub Pages liefert den aktuellen Flutter-Build.',
  ),
  VersionHistoryEntry(
    version: '1.0.9',
    tr: 'İptal alt tarama çubuğunda; büyük diskte DCIM/GoPro/DJI önce ve GPS okuma; iPhone için web (dosya seçici).',
    en: 'Cancel on bottom scan bar; prioritize DCIM/GoPro/DJI + GPS on large disks; web for iPhone file pick.',
    de: 'Abbruch in der unteren Scan-Leiste; DCIM/GoPro/DJI zuerst + GPS; Web für iPhone-Dateiauswahl.',
  ),
  VersionHistoryEntry(
    version: '1.0.8',
    tr: 'SD kart Android/data izin hatası atlanır; tarama DCIM ve diğer klasörlerde devam eder.',
    en: 'Skip SD Android/data permission errors; scan continues in DCIM and other folders.',
    de: 'SD Android/data-Berechtigungsfehler überspringen; Scan in DCIM u. a. weiter.',
  ),
  VersionHistoryEntry(
    version: '1.0.7',
    tr: 'SD / harici disk taraması hızlandı; UI kilitlenmesi azaltıldı. GPS derin tarama “yeniden dene” ile.',
    en: 'Faster SD/external disk scanning; less UI freeze. Deep GPS via retry missing.',
    de: 'Schnellerer SD-/Externspeicher-Scan; weniger UI-Einfrieren. Tiefes GPS über erneutes Prüfen.',
  ),
  VersionHistoryEntry(
    version: '1.0.6',
    tr: '2 sürüm geride kalan cihazlarda zorunlu güncelleme; aksi halde uygulama kullanılamaz.',
    en: 'Force update when two or more versions behind; otherwise the app cannot be used.',
    de: 'Zwangsupdate bei zwei oder mehr Versionen Rückstand; sonst ist die App nicht nutzbar.',
  ),
  VersionHistoryEntry(
    version: '1.0.5',
    tr: 'Release derlemesi düzeltildi (video_thumbnail kaldırıldı); güncelleme 1.0.x’e çıkar. Küçük hata düzeltmeleri.',
    en: 'Fixed release build (removed video_thumbnail); updates reach 1.0.x. Minor bug fixes.',
    de: 'Release-Build behoben (video_thumbnail entfernt); Updates erreichen 1.0.x. Kleine Fehlerkorrekturen.',
  ),
  VersionHistoryEntry(
    version: '1.0.4',
    tr: 'Videolar telefonda düğmesiz otomatik oynar; gerekirse telefon oynatıcısı açılır. Küçük hata düzeltmeleri.',
    en: 'Videos auto-play on phone without a play button; falls back to the phone player if needed. Minor bug fixes.',
    de: 'Videos starten auf dem Telefon automatisch ohne Play-Button; sonst Telefon-Player. Kleine Fehlerkorrekturen.',
  ),
  VersionHistoryEntry(
    version: '1.0.3',
    tr: 'Telefonda GoPro/DJI için “Telefonda oynat”; Windows ifadesi kaldırıldı. Küçük hata düzeltmeleri.',
    en: 'Phone playback label for GoPro/DJI on Android; removed Windows wording. Minor bug fixes.',
    de: 'Wiedergabe auf dem Telefon für GoPro/DJI unter Android; Windows-Text entfernt. Kleine Fehlerkorrekturen.',
  ),
  VersionHistoryEntry(
    version: '1.0.2',
    tr:
        'SD kart / harici disk tarama; disk çıkınca pinler gizlenir, takılınca geri gelir. Küçük hata düzeltmeleri.',
    en:
        'Scan SD card / external disk; pins hide when removed and return on remount. Minor bug fixes.',
    de:
        'SD-Karte / externe Festplatte scannen; Pins ausblenden beim Entfernen, zurück beim erneuten Anschließen. Kleine Fehlerkorrekturen.',
  ),
  VersionHistoryEntry(
    version: '1.0.1',
    tr:
        'GoPro GPMF ve DJI SRT/konum okuma; Android’de GoPro/DJI video oynatma. Küçük hata düzeltmeleri.',
    en:
        'GoPro GPMF and DJI SRT/location reading; GoPro/DJI playback on Android. Minor bug fixes.',
    de:
        'GoPro-GPMF- und DJI-SRT/Standortlesung; GoPro/DJI-Wiedergabe auf Android. Kleine Fehlerkorrekturen.',
  ),
  VersionHistoryEntry(
    version: '1.0.0',
    tr:
        'Video ızgarasında ilk kare önizleme; ayarlarda sürüm geçmişi; geliştiren adı sabit kredi. Küçük hata düzeltmeleri.',
    en:
        'First-frame video thumbnails in the grid; version history in settings; fixed developer credit. Minor bug fixes.',
    de:
        'Erste-Frame-Vorschaubilder für Videos; Versionsverlauf in den Einstellungen; fester Entwicklername. Kleine Fehlerkorrekturen.',
  ),
  VersionHistoryEntry(
    version: '0.8.0',
    tr:
        'Marka odaklı arayüz; Türkçe / İngilizce / Almanca; yardım; harita türleri; ayarlar.',
    en:
        'Brand-focused UI; Turkish / English / German; help; map layers; settings.',
    de:
        'Markenorientierte Oberfläche; Türkisch / Englisch / Deutsch; Hilfe; Kartenebenen; Einstellungen.',
  ),
  VersionHistoryEntry(
    version: '0.7.9',
    tr: 'Harita odaklı ana ekran; açılışta otomatik güncelleme kontrolü.',
    en: 'Map-first home screen; automatic update check on launch.',
    de: 'Kartenorientierter Startbildschirm; automatische Update-Prüfung beim Start.',
  ),
  VersionHistoryEntry(
    version: '0.7.8',
    tr: 'Sabit APK imzası — güncelleme için uygulamayı silmeye gerek yok.',
    en: 'Stable APK signing — updates without uninstalling.',
    de: 'Stabile APK-Signatur — Updates ohne Neuinstallation.',
  ),
  VersionHistoryEntry(
    version: '0.7.6',
    tr: 'Tüm telefon medya taraması; GPS konum okuma iyileştirmeleri.',
    en: 'Full-phone media scan; GPS location reading improvements.',
    de: 'Vollständiger Telefon-Medienscan; verbesserte GPS-Standortlesung.',
  ),
  VersionHistoryEntry(
    version: '0.7.3',
    tr: 'Uygulama içi GitHub Releases güncellemesi (Android + Windows).',
    en: 'In-app updates from GitHub Releases (Android + Windows).',
    de: 'In-App-Updates über GitHub Releases (Android + Windows).',
  ),
  VersionHistoryEntry(
    version: '0.7.1',
    tr: 'Windows zip sürümü ve indirme bağlantıları.',
    en: 'Windows zip release and download links.',
    de: 'Windows-Zip-Release und Download-Links.',
  ),
];
