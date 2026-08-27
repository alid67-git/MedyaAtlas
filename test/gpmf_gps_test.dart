import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';

import 'package:medyaatlas/services/gpmf_gps.dart';
import 'package:medyaatlas/services/video_gps.dart';

Uint8List _gpmfSample({
  required int latE7,
  required int lonE7,
}) {
  // Minimal: DEVC { SCAL(l,2) + GPS5(l,5×1) } — 4-byte aligned.
  final out = BytesBuilder();
  void four(String s) => out.add(s.codeUnits);
  void u8(int v) => out.addByte(v);
  void u16(int v) {
    u8((v >> 8) & 0xff);
    u8(v & 0xff);
  }

  void i32(int v) {
    u8((v >> 24) & 0xff);
    u8((v >> 16) & 0xff);
    u8((v >> 8) & 0xff);
    u8(v & 0xff);
  }

  // DEVC container type=0 size=1 repeat=payloadLen later patched
  final start = out.length;
  four('DEVC');
  u8(0); // nested
  u8(1); // size unit
  // repeat = payload bytes — fill after
  final repeatAt = out.length;
  u16(0);

  final payloadStart = out.length;
  // SCAL: type 'l', size 4, repeat 2 → lat/lon scales 1e7
  four('SCAL');
  u8(0x6c);
  u8(4);
  u16(2);
  i32(10000000);
  i32(10000000);
  // GPS5: type 'l', size 20 (5×4), repeat 1
  four('GPS5');
  u8(0x6c);
  u8(20);
  u16(1);
  i32(latE7);
  i32(lonE7);
  i32(0); // alt
  i32(0); // speed2d
  i32(0); // speed3d
  final payloadLen = out.length - payloadStart;
  // patch DEVC repeat
  final bytes = out.toBytes();
  bytes[repeatAt] = (payloadLen >> 8) & 0xff;
  bytes[repeatAt + 1] = payloadLen & 0xff;
  // ignore unused start
  assert(start == 0);
  return bytes;
}

void main() {
  test('extractGpmfGps reads GPS5 with SCAL', () {
    final data = _gpmfSample(latE7: 410123456, lonE7: 289876543);
    final point = extractGpmfGps(data);
    expect(point, isNotNull);
    expect(point!.latitude, closeTo(41.0123456, 1e-6));
    expect(point.longitude, closeTo(28.9876543, 1e-6));
  });

  test('scanVideoBytesForGps finds GPMF in large buffer', () async {
    final sample = _gpmfSample(latE7: 400000000, lonE7: 300000000);
    final big = Uint8List(300 * 1024);
    big.setRange(big.length - sample.length, big.length, sample);
    final point = await scanVideoBytesForGps(big);
    expect(point, isA<LatLng>());
    expect(point!.latitude, closeTo(40.0, 1e-5));
    expect(point.longitude, closeTo(30.0, 1e-5));
  });
}
