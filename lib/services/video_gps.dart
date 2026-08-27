import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:latlong2/latlong.dart';
import 'package:path/path.dart' as p;

import 'geo.dart';
import 'gpmf_gps.dart';
import 'header_gps.dart';
import 'local_fs.dart';

/// Video GPS tarama üst sınırı (GoPro GPMF / DJI gömülü metin) — dosya başı.
const videoGpsScanBytes = 24 * 1024 * 1024;

/// GoPro `moov`/GPMF sıkça sonda — kuyruk taraması.
const videoGpsTailBytes = 16 * 1024 * 1024;

/// Telefon videosu / şüpheli GX: önce küçük sonda ara (hız).
const videoGpsLightHeadBytes = 2 * 1024 * 1024;
const videoGpsLightTailBytes = 2 * 1024 * 1024;

/// Bu boyuttan büyük tamponlarda GPMF/ASCII ayrı isolate’ta (ANR önlemi).
const _gpsIsolateThreshold = 256 * 1024;

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

/// Head/tail tamponundan GPS — büyük tamponlarda isolate (UI donmasın).
Future<LatLng?> scanVideoBytesForGps(Uint8List bytes) async {
  if (bytes.isEmpty) return null;
  if (kIsWeb || bytes.length < _gpsIsolateThreshold) {
    return extractHeaderGps(bytes) ??
        extractGpmfGps(bytes) ??
        extractAsciiGpsHints(bytes);
  }
  try {
    final packed = await compute(_packGpsScan, bytes);
    return latLngOrNull(packed.$1, packed.$2);
  } catch (_) {
    return extractHeaderGps(bytes) ??
        extractGpmfGps(bytes) ??
        extractAsciiGpsHints(bytes);
  }
}

(double?, double?) _packGpsScan(Uint8List bytes) {
  final point = extractHeaderGps(bytes) ??
      extractGpmfGps(bytes) ??
      extractAsciiGpsHints(bytes);
  return (point?.latitude, point?.longitude);
}

/// Video konumu: ©xyz / ISO6709 → DJI SRT → GPMF → ASCII ipuçları.
///
/// [deepScan]=false: yalnızca verilen head + SRT (SD toplu tarama).
/// [deepScan]=true: dosya başı + kuyruk (GoPro GPMF sonda olabilir).
Future<LatLng?> extractVideoGps({
  required String? localPath,
  Uint8List? head,
  Uint8List? tail,
  String? relativePath,
  bool deepScan = true,
  int maxScanBytes = videoGpsScanBytes,
  int maxTailBytes = videoGpsTailBytes,
  bool Function()? isCancelled,
}) async {
  if (isCancelled?.call() == true) return null;
  LatLng? point;

  if (head != null && head.isNotEmpty) {
    point = await scanVideoBytesForGps(head);
    if (point != null) return point;
  }
  if (tail != null && tail.isNotEmpty) {
    if (isCancelled?.call() == true) return null;
    point = await scanVideoBytesForGps(tail);
    if (point != null) return point;
  }

  if (isCancelled?.call() == true) return null;
  point = await extractDjiSidecarGps(localPath);
  if (point != null) return point;

  if (!deepScan) return null;
  if (kIsWeb || localPath == null || localPath.isEmpty) return null;
  if (isCancelled?.call() == true) return null;
  try {
    if (!await localFileExists(localPath)) return null;
    if (isCancelled?.call() == true) return null;
    final size = await localFileLength(localPath);
    if (size <= 0) return null;
    final headLimit = math.min(maxScanBytes, size);
    // head zaten yeterince büyükse tekrar okuma.
    if (head == null || head.length < headLimit) {
      final bytes = await readLocalFileHead(
        localPath,
        headLimit,
        isCancelled: isCancelled,
      );
      if (isCancelled?.call() == true) return null;
      if (bytes.isNotEmpty) {
        point = await scanVideoBytesForGps(bytes);
        if (point != null) return point;
      }
    }

    // Kuyruk: baş ile örtüşmeyen kısım.
    final tailLimit = math.min(maxTailBytes, size);
    if (tailLimit > 0 && size > headLimit) {
      if (isCancelled?.call() == true) return null;
      // Verilen tail yeterince büyükse atla.
      if (tail == null || tail.length < tailLimit) {
        final tailBytes = await readLocalFileTail(
          localPath,
          tailLimit,
          isCancelled: isCancelled,
        );
        if (isCancelled?.call() == true || tailBytes.isEmpty) return null;
        point = await scanVideoBytesForGps(tailBytes);
        if (point != null) return point;
      }
    }
    return null;
  } catch (_) {
    return null;
  }
}
