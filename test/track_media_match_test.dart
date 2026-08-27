import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:medyaatlas/models/library_media.dart';
import 'package:medyaatlas/models/map_track.dart';
import 'package:medyaatlas/services/track_media_match.dart';

void main() {
  test('isNearTrack uses segment not only vertices', () {
    final track = [
      const LatLng(41.0, 29.0),
      const LatLng(41.0, 29.1), // ~8 km east
    ];
    // Midpoint of segment — far from both vertices if only point-check with small radius.
    const mid = LatLng(41.0, 29.05);
    expect(isNearTrack(mid, track, maxMeters: 500), isTrue);
    expect(isNearTrack(const LatLng(42.0, 30.0), track, maxMeters: 2500), isFalse);
  });

  test('mediaMatchesTracks by time places GPS-less GoPro', () {
    final start = DateTime.utc(2026, 8, 1, 10);
    final end = DateTime.utc(2026, 8, 1, 18);
    final track = MapTrack(
      id: 't1',
      name: 'tour',
      sourceId: 's',
      timeStart: start.millisecondsSinceEpoch,
      timeEnd: end.millisecondsSinceEpoch,
      points: [
        TrackPoint(
          latitude: 41.0,
          longitude: 29.0,
          timeMs: start.millisecondsSinceEpoch,
        ),
        TrackPoint(
          latitude: 41.1,
          longitude: 29.1,
          timeMs: end.millisecondsSinceEpoch,
        ),
      ],
    );
    final gopro = LibraryMedia(
      id: 'g1',
      name: 'GH010123.MP4',
      addedAt: DateTime.utc(2026, 8, 2),
      kind: MediaKind.gopro,
      sourceId: 'phone',
      takenAt: DateTime.utc(2026, 8, 1, 14),
    );
    expect(mediaMatchesTracks(gopro, [track]), isTrue);
    final pos = resolveMediaOnTracks(gopro, [track]);
    expect(pos, isNotNull);
    expect(pos!.latitude, closeTo(41.05, 0.02));
  });

  test('wide spatial tolerance keeps near-road GPS', () {
    final track = [
      const LatLng(41.0, 29.0),
      const LatLng(41.05, 29.05),
    ];
    // ~1.2 km off the line
    const off = LatLng(41.01, 29.0);
    expect(isNearTrack(off, track, maxMeters: 2500), isTrue);
  });
}
