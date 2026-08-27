import 'dart:convert';
import 'dart:typed_data';

import 'track_parse.dart';

/// İz dosyası üst sınırı (yaklaşık). Daha büyüğü uyarı ile reddedilir.
const trackFileMaxBytes = 256 * 1024 * 1024;

class PickedTrackFile {
  const PickedTrackFile({required this.name, required this.bytes});

  final String name;
  final Uint8List bytes;
}

class TrackPickResult {
  const TrackPickResult({
    required this.files,
    this.skippedWrongType = 0,
    this.skippedUnreadable = 0,
    this.skippedTooLarge = 0,
    this.skippedSawMedia = false,
  });

  final List<PickedTrackFile> files;
  final int skippedWrongType;
  final int skippedUnreadable;
  final int skippedTooLarge;
  /// Seçilenlerden en az biri foto/video gibi görünüyordu.
  final bool skippedSawMedia;

  bool get isEmpty => files.isEmpty;
  int get skippedTotal =>
      skippedWrongType + skippedUnreadable + skippedTooLarge;
}

/// Uzantı yoksa / yanlışsa içerikten GPX·KML·KMZ tanı.
bool looksLikeTrackBytes(List<int> bytes) {
  if (bytes.isEmpty) return false;
  // KMZ = zip
  if (bytes.length >= 4 &&
      bytes[0] == 0x50 &&
      bytes[1] == 0x4b &&
      (bytes[2] == 0x03 || bytes[2] == 0x05 || bytes[2] == 0x07)) {
    return true;
  }
  final n = bytes.length < 800 ? bytes.length : 800;
  final head = utf8.decode(bytes.sublist(0, n), allowMalformed: true).toLowerCase();
  return head.contains('<gpx') ||
      head.contains('<kml') ||
      head.contains('http://www.opengis.net/kml') ||
      head.contains('topografix.com/gpx');
}

/// Galeri/foto seçildi mi? (yanlış tür mesajı için)
bool looksLikeImageOrVideoName(String name) {
  return RegExp(
    r'\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tif{1,2}|mp4|mov|m4v|avi|mkv|3gp)$',
    caseSensitive: false,
  ).hasMatch(name);
}

bool looksLikeImageBytes(List<int> bytes) {
  if (bytes.length < 12) return false;
  // JPEG
  if (bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff) return true;
  // PNG
  if (bytes[0] == 0x89 &&
      bytes[1] == 0x50 &&
      bytes[2] == 0x4e &&
      bytes[3] == 0x47) {
    return true;
  }
  // GIF
  if (bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46) return true;
  // HEIC/HEIF (ftyp....heic/heif/mif1)
  if (bytes[4] == 0x66 &&
      bytes[5] == 0x74 &&
      bytes[6] == 0x79 &&
      bytes[7] == 0x70) {
    final brand =
        utf8.decode(bytes.sublist(8, 12), allowMalformed: true).toLowerCase();
    if (brand.contains('heic') ||
        brand.contains('heif') ||
        brand.contains('mif1') ||
        brand.contains('msf1')) {
      return true;
    }
  }
  return false;
}

bool isAcceptableTrackFile({required String name, required List<int> bytes}) =>
    isTrackFileName(name) || looksLikeTrackBytes(bytes);

/// Kullanıcıya net uyarı — Galeri/foto vs gerçek GPX.
String trackWrongTypeMessage({
  required int count,
  bool sawMedia = false,
}) {
  if (sawMedia) {
    return 'Foto/video seçildi (Galeri). GPX için Dosyalar / dosya yöneticisi / '
        'İndirilenler’den .gpx · .kml · .kmz seçin — Galeri değil.';
  }
  if (count > 1) {
    return '$count dosya GPX/KML/KMZ değil. Uzantı .gpx / .kml / .kmz olmalı '
        '(Galeri değil — Dosyalar / İndirilenler).';
  }
  return 'GPX/KML/KMZ değil. Dosyalar veya İndirilenler’den .gpx seçin '
      '(Galeri / Fotoğraflar değil).';
}
