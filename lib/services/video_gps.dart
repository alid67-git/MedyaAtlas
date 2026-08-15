import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:latlong2/latlong.dart';
import 'package:path/path.dart' as p;

import 'geo.dart';
import 'gpmf_gps.dart';
import 'header_gps.dart';
import 'local_fs.dart';

/// Video GPS tarama üst sınırı (GoPro GPMF / DJI gömülü metin).
const videoGpsScanBytes = 24 * 1024 * 1024;

final _djiLatLon = RegExp(
  r'\[?\s*latitude\s*[:\s]\s*([+-]?\d+(?:\.\d+)?)\s*\]?[\s\S]{0,80}?'
  r'\[?\s*longitude\s*[:\s]\s*([+-]?\d+(?:\.\d+)?)\s*\]?',
  caseSensitive: false,
);

final _djiGpsParen = RegExp(
  r'GPS\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)',
  caseSensitive: false,
);

final _djiLatLonCsv = RegExp(
  r'Latitude\s*[:=]\s*([+-]?\d+(?:\.\d+)?)[^\d.+-]{0,40}'
  r'Longitude\s*[:=]\s*([+-]?\d+(?:\.\d+)?)',
  caseSensitive: false,
);

/// DJI `.SRT` yan dosyası veya SRT benzeri metinden ilk GPS.
LatLng? parseDjiSrtGps(String text) {
  if (text.isEmpty) return null;
  for (final re in [_djiLatLon, _djiGpsParen, _djiLatLonCsv]) {
    final m = re.firstMatch(text);
    if (m == null) continue;
    final point = latLngOrNull(
      double.tryParse(m.group(1) ?? ''),
      double.tryParse(m.group(2) ?? ''),
    );
    if (point != null) return point;
  }
  return null;
}

Future<LatLng?> extractDjiSidecarGps(String? videoPath) async {
  if (kIsWeb || videoPath == null || videoPath.isEmpty) return null;
  final dir = p.dirname(videoPath);
  final base = p.basenameWithoutExtension(videoPath);
  for (final ext in ['.SRT', '.srt', '.ASS', '.ass']) {
    final path = p.join(dir, '$base$ext');
    try {
      final bytes = await readLocalTextFileLimited(path);
      if (bytes == null || bytes.isEmpty) continue;
      final text = String.fromCharCodes(bytes);
      final point = parseDjiSrtGps(text);
      if (point != null) return point;
    } catch (_) {}
  }
  return null;
}

LatLng? extractAsciiGpsHints(Uint8List bytes) {
  if (bytes.isEmpty) return null;
  // Latin-1 güvenli; GPS metinleri ASCII.
  final text = String.fromCharCodes(bytes);
  return parseDjiSrtGps(text) ?? extractHeaderGps(bytes);
}

/// Video konumu: ©xyz / ISO6709 → DJI SRT → GPMF → ASCII ipuçları.
///
/// [deepScan]=false: yalnızca verilen head + SRT (SD toplu tarama).
/// [deepScan]=true: dosyadan en fazla [maxScanBytes] okur (yeniden dene / GoPro).
Future<LatLng?> extractVideoGps({
  required String? localPath,
  Uint8List? head,
  String? relativePath,
  bool deepScan = true,
  int maxScanBytes = videoGpsScanBytes,
}) async {
  LatLng? point;

  if (head != null && head.isNotEmpty) {
    point = extractHeaderGps(head);
    point ??= extractGpmfGps(head);
    point ??= extractAsciiGpsHints(head);
    if (point != null) return point;
  }

  point = await extractDjiSidecarGps(localPath);
  if (point != null) return point;

  if (!deepScan) return null;
  if (kIsWeb || localPath == null || localPath.isEmpty) return null;
  try {
    if (!await localFileExists(localPath)) return null;
    final size = await localFileLength(localPath);
    if (size <= 0) return null;
    final limit = math.min(maxScanBytes, size);
    // head zaten yeterince büyükse tekrar okuma.
    if (head != null && head.length >= limit) {
      return extractGpmfGps(head) ?? extractAsciiGpsHints(head);
    }
    final bytes = await readLocalFileHead(localPath, limit);
    point = extractHeaderGps(bytes);
    point ??= extractGpmfGps(bytes);
    point ??= extractAsciiGpsHints(bytes);
    return point;
  } catch (_) {
    return null;
  }
}
