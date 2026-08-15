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
