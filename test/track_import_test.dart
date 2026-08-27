import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:medyaatlas/models/map_track.dart';
import 'package:medyaatlas/services/track_parse.dart';

void main() {
  test('trackContentKey aynı rota için eşit', () {
    final a = parseGpxText(
      '''<?xml version="1.0"?>
<gpx><trk><trkseg>
<trkpt lat="41.0" lon="29.0"><time>2026-08-01T10:00:00Z</time></trkpt>
<trkpt lat="41.1" lon="29.1"><time>2026-08-01T11:00:00Z</time></trkpt>
</trkseg></trk></gpx>''',
      name: 'tour.gpx',
      sourceId: 'rides',
    )!;
    final b = parseGpxText(
      '''<?xml version="1.0"?>
<gpx><trk><trkseg>
<trkpt lat="41.0" lon="29.0"><time>2026-08-01T10:00:00Z</time></trkpt>
<trkpt lat="41.1" lon="29.1"><time>2026-08-01T11:00:00Z</time></trkpt>
</trkseg></trk></gpx>''',
      name: 'tour.gpx',
      sourceId: 'rides',
    )!;
    expect(a.id, isNot(b.id));
    expect(trackContentKey(a), trackContentKey(b));
  });

  test('parseTrackIsolate Map argümanı', () {
    final bytes = Uint8List.fromList(
      '''<?xml version="1.0"?>
<gpx><trk><trkseg>
<trkpt lat="40.0" lon="30.0"></trkpt>
<trkpt lat="40.1" lon="30.1"></trkpt>
</trkseg></trk></gpx>'''
          .codeUnits,
    );
    final track = parseTrackIsolate({
      'fileName': 'a.gpx',
      'bytes': bytes,
    });
    expect(track, isNotNull);
    expect(track!.points.length, greaterThanOrEqualTo(2));
  });
}
