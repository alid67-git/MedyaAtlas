import '../services/app_settings.dart';

/// Basit TR / EN / DE metinleri (kod içi; gen-l10n yok).
class S {
  S(this.lang);
  final AppLang lang;

  static S of(AppSettings settings) => S(settings.lang);

  String get appName => 'MediaAtlas';

  String get developedBy => switch (lang) {
        AppLang.tr => 'Geliştiren',
        AppLang.en => 'Developed by',
        AppLang.de => 'Entwickelt von',
      };

  String get sources => switch (lang) {
        AppLang.tr => 'Medya kaynakları',
        AppLang.en => 'Media sources',
        AppLang.de => 'Medienquellen',
      };

  String get gpsLocated => switch (lang) {
        AppLang.tr => 'GPS konumlu',
        AppLang.en => 'With GPS',
        AppLang.de => 'Mit GPS',
      };

  String get noLocation => switch (lang) {
        AppLang.tr => 'Konum bulunamayan',
        AppLang.en => 'No location',
        AppLang.de => 'Ohne Standort',
      };

  String get fitAll => switch (lang) {
        AppLang.tr => 'Tüm pinler',
        AppLang.en => 'Fit all pins',
        AppLang.de => 'Alle Pins',
      };

  String get mapLayers => switch (lang) {
        AppLang.tr => 'Harita türü',
        AppLang.en => 'Map type',
        AppLang.de => 'Kartentyp',
      };

  String get settings => switch (lang) {
        AppLang.tr => 'Ayarlar',
        AppLang.en => 'Settings',
        AppLang.de => 'Einstellungen',
      };

  String get help => switch (lang) {
        AppLang.tr => 'Yardım',
        AppLang.en => 'Help',
        AppLang.de => 'Hilfe',
      };

  String get language => switch (lang) {
        AppLang.tr => 'Dil',
        AppLang.en => 'Language',
        AppLang.de => 'Sprache',
      };

  String get version => switch (lang) {
        AppLang.tr => 'Sürüm',
        AppLang.en => 'Version',
        AppLang.de => 'Version',
      };

  String get versionHistory => switch (lang) {
        AppLang.tr => 'Sürüm geçmişi',
        AppLang.en => 'Version history',
        AppLang.de => 'Versionsverlauf',
      };

  String get cancel => switch (lang) {
        AppLang.tr => 'İptal',
        AppLang.en => 'Cancel',
        AppLang.de => 'Abbrechen',
      };

  String get close => switch (lang) {
        AppLang.tr => 'Kapat',
        AppLang.en => 'Close',
        AppLang.de => 'Schließen',
      };

  String get retryMissing => switch (lang) {
        AppLang.tr => 'Konum yokları yeniden dene',
        AppLang.en => 'Retry missing locations',
        AppLang.de => 'Fehlende Standorte erneut prüfen',
      };

  String get dropHint => switch (lang) {
        AppLang.tr => 'Klasörü bırak — MediaAtlas tarar, kopyalamaz',
        AppLang.en => 'Drop folder — MediaAtlas indexes, does not copy',
        AppLang.de => 'Ordner ablegen — MediaAtlas indexiert, kopiert nicht',
      };

  String get layerSatellite => switch (lang) {
        AppLang.tr => 'Uydu',
        AppLang.en => 'Satellite',
        AppLang.de => 'Satellit',
      };

  String get layerStreets => switch (lang) {
        AppLang.tr => 'Sokak',
        AppLang.en => 'Streets',
        AppLang.de => 'Straßen',
      };

  String get layerTopo => switch (lang) {
        AppLang.tr => 'Topo',
        AppLang.en => 'Topo',
        AppLang.de => 'Topo',
      };

  String get layerDark => switch (lang) {
        AppLang.tr => 'Koyu',
        AppLang.en => 'Dark',
        AppLang.de => 'Dunkel',
      };

  String mapLayerLabel(MapLayer layer) => switch (layer) {
        MapLayer.satellite => layerSatellite,
        MapLayer.streets => layerStreets,
        MapLayer.topo => layerTopo,
        MapLayer.dark => layerDark,
      };

  String langLabel(AppLang value) => switch (value) {
        AppLang.tr => 'Türkçe',
        AppLang.en => 'English',
        AppLang.de => 'Deutsch',
      };

  String get helpTitle => switch (lang) {
        AppLang.tr => 'MediaAtlas Yardım',
        AppLang.en => 'MediaAtlas Help',
        AppLang.de => 'MediaAtlas Hilfe',
      };

  /// Uzun yardım metni (markdown benzeri düz metin).
  String get helpBody => switch (lang) {
        AppLang.tr => '''
MediaAtlas, fotoğraf ve videolarınızdaki GPS konumlarını dünya haritasında gösterir. Dosyaları bir yerden bir yere kopyalamaz; yalnızca indeks tutar (ad, yol, GPS).

## Ne yapabilirsiniz?
• Kaynaklar: Klasör / Galeri / Tüm telefon / Google Drive / GPX·KML — her kaynakta «yeniden tara»
• SD/USB ve disk kökleri Klasör seçimiyle eklenir (ayrı Disk butonu yok)
• GPS’li medya haritada pin; GPX/KML/KMZ izleri turuncu çizgi
• Harita: uydu / sokak / topo / koyu
• iPhone web: dosya kopyalanmaz; sayfa yenilenince medyayı yeniden seçin

## İzinler (Android)
Fotoğraf, video ve “medya konumu” (EXIF GPS) gerekir. Bilinmeyen uygulamalardan yükleme, güncelleme için gereklidir.

## İndirme
https://github.com/alid67-git/MedyaAtlas/releases/download/android-latest/MedyaAtlas.apk

## Notlar
Google Fotoğraflar bulutu taranmaz; yerel dosya veya Google Drive gerekir. Windows’ta run_windows.bat / C:\\src\\MedyaAtlas kullanılır.
''',
        AppLang.en => '''
MediaAtlas shows GPS locations from your photos and videos on a world map. It does not copy files from place to place; it only keeps an index (name, path, GPS).

## What you can do
• Sources: Folder / Gallery / Whole phone / Google Drive / GPX·KML — tap sync on a source to rescan
• SD/USB and disk roots are added via Folder (no separate Disk button)
• GPS media as map pins; GPX/KML/KMZ tracks as orange lines
• Map: satellite / street / topo / dark
• iPhone web: files are not copied; re-select media after refresh

## Permissions (Android)
Photos, videos, and “media location” (EXIF GPS) are required. Install from unknown apps is needed for updates.

## Download
https://github.com/alid67-git/MedyaAtlas/releases/download/android-latest/MedyaAtlas.apk

## Notes
Google Photos cloud is not scanned; use local files or Google Drive. On Windows use run_windows.bat / C:\\src\\MedyaAtlas.
''',
        AppLang.de => '''
MediaAtlas zeigt GPS-Positionen aus Fotos und Videos auf einer Weltkarte. Dateien werden nicht kopiert; nur lokal indexiert.

## Funktionen
• Quellen: Ordner / Galerie / Ganzes Telefon / Google Drive / GPX·KML — Sync-Taste zum erneuten Scannen
• SD/USB und Disk-Wurzeln über Ordner (kein eigener Disk-Button)
• GPS-Medien als Pins; GPX/KML/KMZ-Tracks als orangene Linien
• Karte: Satellit / Straße / Topo / Dunkel
• iPhone-Web: keine Dateikopie; nach Reload Medien neu wählen

## Berechtigungen (Android)
Fotos, Videos und Medienstandort (EXIF-GPS) sind nötig. Unbekannte Apps installieren wird für Updates benötigt.

## Download
https://github.com/alid67-git/MedyaAtlas/releases/download/android-latest/MedyaAtlas.apk

## Hinweise
Google Fotos Cloud wird nicht gescannt; lokale Dateien oder Google Drive nutzen. Unter Windows: run_windows.bat / C:\\src\\MedyaAtlas.
''',
      };
}
