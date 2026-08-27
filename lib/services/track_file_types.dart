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
bool looksLikeTrackBytes(List<int> bytes) =>
    detectTrackFormat(fileName: '', bytes: bytes) != null;

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
    detectTrackFormat(fileName: name, bytes: bytes) != null;

/// Kullanıcıya net uyarı — Galeri/foto vs gerçek GPX.
String trackWrongTypeMessage({
  required int count,
  bool sawMedia = false,
}) {
  if (sawMedia) {
    return 'Foto/video seçildi (Galeri). GPX için Dosyalar / Browse / Drive’dan seçin — '
        'Fotoğraflar değil. Uzantı olmasa da GPX içeriği kabul edilir.';
  }
  if (count > 1) {
    return '$count dosya GPX/KML içeriği değil. Drive’daki uzantısız kayıtlar da '
        'Dosyalar’dan seçilebilir; Fotoğraflar değil.';
  }
  return 'GPX/KML içeriği tanınmadı. Drive’da uzantı olmasa da Dosyalar / Browse ile seçin '
      '(Fotoğraflar / Galeri değil).';
}
