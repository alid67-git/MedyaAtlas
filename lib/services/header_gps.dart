import 'dart:typed_data';

import 'package:latlong2/latlong.dart';

/// MedyaAtlas `fastLocationExtract` hızlı kademesi: dosyanın tamamı değil,
/// başındaki etiketler (ISO6709 / ©xyz). GoPro GPMF bu yolda yok.
final _iso6709 = RegExp(
  r'([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?/',
);

LatLng? extractHeaderGps(Uint8List bytes) {
  if (bytes.isEmpty) return null;
  final fromXyz = _fromCopyrightXyz(bytes);
  if (fromXyz != null) return fromXyz;
  return _fromIso6709Text(bytes);
}

LatLng? parseIso6709(String value) {
  final match = _iso6709.firstMatch(value.replaceAll(RegExp(r'\s+'), ''));
  if (match == null) return null;
  return _gps(match.group(1), match.group(2));
}

LatLng? _gps(String? latRaw, String? lonRaw) {
  final lat = double.tryParse(latRaw ?? '');
  final lon = double.tryParse(lonRaw ?? '');
  if (lat == null || lon == null) return null;
  if (lat.abs() > 90 || lon.abs() > 180) return null;
  if (lat.abs() < 0.01 && lon.abs() < 0.01) return null;
  return LatLng(lat, lon);
}

LatLng? _fromIso6709Text(Uint8List bytes) {
  return parseIso6709(String.fromCharCodes(bytes));
}

/// QuickTime `©xyz` kutusu: dil kodundan sonra ISO6709.
LatLng? _fromCopyrightXyz(Uint8List bytes) {
  for (var i = 0; i < bytes.length - 12; i++) {
    if (bytes[i] != 0xA9 ||
        bytes[i + 1] != 0x78 ||
        bytes[i + 2] != 0x79 ||
        bytes[i + 3] != 0x7A) {
      continue;
    }
    final start = i + 8;
    final end = (start + 64).clamp(0, bytes.length);
    final parsed = parseIso6709(String.fromCharCodes(bytes.sublist(start, end)));
    if (parsed != null) return parsed;
  }
  return null;
}
