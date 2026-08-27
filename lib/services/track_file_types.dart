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
  });

  final List<PickedTrackFile> files;
  final int skippedWrongType;
  final int skippedUnreadable;
  final int skippedTooLarge;

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

bool isAcceptableTrackFile({required String name, required List<int> bytes}) =>
    isTrackFileName(name) || looksLikeTrackBytes(bytes);
