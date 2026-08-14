import 'dart:typed_data';

import 'package:exif/exif.dart';
import 'package:latlong2/latlong.dart';

import 'geo.dart';

/// Fotoğraf EXIF GPS — RideAtlas ile aynı mantık.
Future<LatLng?> extractExifGps(Uint8List bytes) async {
  final tags = await readExifFromBytes(bytes);
  if (tags.isEmpty) return null;

  final latRef = tags['GPS GPSLatitudeRef']?.toString();
  final lngRef = tags['GPS GPSLongitudeRef']?.toString();
  var lat = _gpsValuesToDegrees(tags['GPS GPSLatitude']?.values);
  var lng = _gpsValuesToDegrees(tags['GPS GPSLongitude']?.values);
  if (latRef == null || lat == null || lngRef == null || lng == null) {
    return null;
  }

  if (latRef == 'S') lat = -lat;
  if (lngRef == 'W') lng = -lng;
  return latLngOrNull(lat, lng);
}

Future<DateTime?> extractExifTakenAt(Uint8List bytes) async {
  final tags = await readExifFromBytes(bytes);
  if (tags.isEmpty) return null;
  final raw = tags['EXIF DateTimeOriginal']?.toString() ??
      tags['Image DateTime']?.toString();
  if (raw == null || raw.isEmpty) return null;
  final normalized = raw.replaceFirstMapped(
    RegExp(r'^(\d{4}):(\d{2}):(\d{2})'),
    (m) => '${m[1]}-${m[2]}-${m[3]}',
  );
  return DateTime.tryParse(normalized);
}

double? _gpsValuesToDegrees(IfdValues? values) {
  if (values is! IfdRatios) return null;
  var sum = 0.0;
  var unit = 1.0;
  for (final ratio in values.ratios) {
    sum += ratio.toDouble() * unit;
    unit /= 60.0;
  }
  return sum;
}
