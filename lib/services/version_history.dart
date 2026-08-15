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
