import 'dart:typed_data';

import 'package:latlong2/latlong.dart';

import 'geo.dart';

/// GoPro GPMF (GPS5 / GPS9) — MP4 içindeki telemetri izinden ilk geçerli konum.
LatLng? extractGpmfGps(Uint8List data) {
  if (data.length < 28) return null;
  // GPMF FourCC genelde 4-byte hizalı — adım 4 (UI ANR / hız).
  for (var i = 0; i + 8 <= data.length; i += 4) {
    if (_fourCcEquals(data, i, 'DEVC')) {
      final point = _walkGpmf(data, i, data.length, null);
      if (point != null) return point;
    }
  }
  for (var i = 0; i + 28 <= data.length; i += 4) {
    if (_fourCcEquals(data, i, 'GPS5') || _fourCcEquals(data, i, 'GPS9')) {
      final key = _fourCc(data, i);
      final type = data[i + 4];
      final size = data[i + 5];
      final repeat = (data[i + 6] << 8) | data[i + 7];
      if (repeat == 0 || size == 0) continue;
      final payload = i + 8;
      if (payload + size > data.length) continue;
      // Yakındaki SCAL (aynı STRM içinde genelde hemen önce).
      final scales = _findNearbyScal(data, i);
      final point = _parseGpsPayload(
        data,
        payload,
        type: type,
        size: size,
        repeat: repeat,
        key: key,
        scales: scales,
      );
      if (point != null) return point;
    }
  }
  return null;
}

bool _fourCcEquals(Uint8List data, int i, String cc) {
  if (i + 4 > data.length) return false;
  return data[i] == cc.codeUnitAt(0) &&
      data[i + 1] == cc.codeUnitAt(1) &&
      data[i + 2] == cc.codeUnitAt(2) &&
      data[i + 3] == cc.codeUnitAt(3);
}

String _fourCc(Uint8List data, int i) =>
    String.fromCharCodes(data.sublist(i, i + 4));

LatLng? _walkGpmf(
  Uint8List data,
  int start,
  int end,
  List<double>? scales,
) {
  var offset = start;
  var localScales = scales;
  while (offset + 8 <= end) {
    final key = _fourCc(data, offset);
    if (!_looksLikeFourCc(key)) return null;
    final type = data[offset + 4];
    final size = data[offset + 5];
    final repeat = (data[offset + 6] << 8) | data[offset + 7];
    final payloadLen = size * repeat;
    final payloadStart = offset + 8;
    if (payloadStart > end) return null;
    final padded = (payloadLen + 3) & ~3;
    if (payloadStart + payloadLen > end) return null;

    if (type == 0) {
      final nested = _walkGpmf(
        data,
        payloadStart,
        payloadStart + payloadLen,
        localScales,
      );
      if (nested != null) return nested;
    } else if (key == 'SCAL') {
      localScales = _parseScal(data, payloadStart, type, size, repeat);
    } else if (key == 'GPS5' || key == 'GPS9') {
      final point = _parseGpsPayload(
        data,
        payloadStart,
        type: type,
        size: size,
        repeat: repeat,
        key: key,
        scales: localScales,
      );
      if (point != null) return point;
    }
    offset = payloadStart + padded;
  }
  return null;
}

bool _looksLikeFourCc(String key) {
  if (key.length != 4) return false;
  for (final c in key.codeUnits) {
    final ok = (c >= 0x30 && c <= 0x39) ||
        (c >= 0x41 && c <= 0x5A) ||
        (c >= 0x61 && c <= 0x7A);
    if (!ok) return false;
  }
  return true;
}

List<double>? _parseScal(
  Uint8List data,
  int start,
  int type,
  int size,
  int repeat,
) {
  final out = <double>[];
  final total = size * repeat;
  if (start + total > data.length) return null;
  // 'l' / 'L' / 's' / 'S' / 'f'
  if (type == 0x6C || type == 0x4C) {
    // signed/unsigned long
    for (var i = 0; i + 4 <= total; i += 4) {
      out.add(_readInt32Be(data, start + i).toDouble());
    }
  } else if (type == 0x73 || type == 0x53) {
    for (var i = 0; i + 2 <= total; i += 2) {
      out.add(_readInt16Be(data, start + i).toDouble());
    }
  } else if (type == 0x66) {
    for (var i = 0; i + 4 <= total; i += 4) {
      out.add(_readFloat32Be(data, start + i));
    }
  } else {
    return null;
  }
  return out.isEmpty ? null : out;
}

List<double>? _findNearbyScal(Uint8List data, int gpsOffset) {
  final from = (gpsOffset - 256).clamp(0, data.length);
  for (var i = gpsOffset - 8; i >= from; i -= 4) {
    if (!_fourCcEquals(data, i, 'SCAL')) continue;
    final type = data[i + 4];
    final size = data[i + 5];
    final repeat = (data[i + 6] << 8) | data[i + 7];
    final payload = i + 8;
    if (payload + size * repeat > gpsOffset) continue;
    final scales = _parseScal(data, payload, type, size, repeat);
    if (scales != null && scales.isNotEmpty) return scales;
  }
  return null;
}

LatLng? _parseGpsPayload(
  Uint8List data,
  int start, {
  required int type,
  required int size,
  required int repeat,
  required String key,
  required List<double>? scales,
}) {
  if (repeat <= 0 || size <= 0) return null;
  // GPS5: 5 × int32; GPS9: 9 × int32 (veya karışık) — lat/lon ilk iki alan.
  if (type != 0x6C && type != 0x4C && type != 0x66) return null;
  final sampleSize = size;
  if (sampleSize < 8) return null;

  final sLat = (scales != null && scales.isNotEmpty) ? scales[0] : 1e7;
  final sLon = (scales != null && scales.length > 1) ? scales[1] : 1e7;
  if (sLat == 0 || sLon == 0) return null;

  for (var s = 0; s < repeat; s++) {
    final off = start + s * sampleSize;
    if (off + 8 > data.length) break;
    double lat;
    double lon;
    if (type == 0x66) {
      // Float örnekler çoğu zaman zaten derece (SCAL≈1).
      final rawLat = _readFloat32Be(data, off);
      final rawLon = _readFloat32Be(data, off + 4);
      if (sLat.abs() > 1000 || sLon.abs() > 1000) {
        lat = rawLat / sLat;
        lon = rawLon / sLon;
      } else {
        lat = rawLat;
        lon = rawLon;
      }
    } else {
      lat = _readInt32Be(data, off) / sLat;
      lon = _readInt32Be(data, off + 4) / sLon;
    }
    final point = latLngOrNull(lat, lon);
    if (point == null) continue;
    if (point.latitude.abs() < 0.0001 && point.longitude.abs() < 0.0001) {
      continue;
    }
    return point;
  }
  return null;
}

int _readInt32Be(Uint8List data, int i) {
  final b = ByteData.sublistView(data, i, i + 4);
  return b.getInt32(0, Endian.big);
}

int _readInt16Be(Uint8List data, int i) {
  final b = ByteData.sublistView(data, i, i + 2);
  return b.getInt16(0, Endian.big);
}

double _readFloat32Be(Uint8List data, int i) {
  final b = ByteData.sublistView(data, i, i + 4);
  return b.getFloat32(0, Endian.big);
}
