import 'package:flutter_test/flutter_test.dart';
import 'package:medyaatlas/models/map_track.dart';

void main() {
  test('tracks sort: route timeEnd, ignores addedAt', () {
    final olderRide = MapTrack(
      id: 'a',
      name: '2024 ride',
      sourceId: 'rides',
      points: const [
        TrackPoint(latitude: 1, longitude: 1),
        TrackPoint(latitude: 2, longitude: 2),
      ],
      timeEnd: 1_700_000_000_000,
      addedAt: 1_900_000_000_000,
    );
    final newerRide = MapTrack(
      id: 'b',
      name: '2026 ride',
      sourceId: 'rides',
      points: const [
        TrackPoint(latitude: 3, longitude: 3),
        TrackPoint(latitude: 4, longitude: 4),
      ],
      timeEnd: 1_800_000_000_000,
      addedAt: 1_000_000_000_000,
    );
    final noDate = MapTrack(
      id: 'c',
      name: 'legacy',
      sourceId: 'rides',
      points: const [
        TrackPoint(latitude: 5, longitude: 5),
        TrackPoint(latitude: 6, longitude: 6),
      ],
      addedAt: 9_000_000_000_000,
    );

    final list = [olderRide, noDate, newerRide]..sort(compareTracksNewestFirst);

    expect(list.map((t) => t.id).toList(), ['b', 'a', 'c']);
  });

  test('tracks sort: point timestamps when timeEnd missing', () {
    final older = MapTrack(
      id: 'a',
      name: 'old',
      sourceId: 'rides',
      points: const [
        TrackPoint(latitude: 1, longitude: 1, timeMs: 1000),
        TrackPoint(latitude: 2, longitude: 2, timeMs: 2000),
      ],
      addedAt: 9_000,
    );
    final newer = MapTrack(
      id: 'b',
      name: 'new',
      sourceId: 'rides',
      points: const [
        TrackPoint(latitude: 3, longitude: 3, timeMs: 5000),
        TrackPoint(latitude: 4, longitude: 4, timeMs: 8000),
      ],
      addedAt: 100,
    );

    final list = [older, newer]..sort(compareTracksNewestFirst);
    expect(list.map((t) => t.id).toList(), ['b', 'a']);
    expect(trackActivityEpochMs(newer), 8000);
  });

  test('tracks sort: addedAt alone does not affect order', () {
    final a = MapTrack(
      id: 'a',
      name: 'aaa',
      sourceId: 'rides',
      points: const [
        TrackPoint(latitude: 1, longitude: 1),
        TrackPoint(latitude: 2, longitude: 2),
      ],
      addedAt: 9_000,
    );
    final b = MapTrack(
      id: 'b',
      name: 'zzz',
      sourceId: 'rides',
      points: const [
        TrackPoint(latitude: 3, longitude: 3),
        TrackPoint(latitude: 4, longitude: 4),
      ],
      addedAt: 100,
    );

    final list = [a, b]..sort(compareTracksNewestFirst);
    // Tarihsiz: ada göre Z→A
    expect(list.map((t) => t.id).toList(), ['b', 'a']);
  });
}
