import 'package:flutter_test/flutter_test.dart';
import 'package:medyaatlas/models/map_track.dart';

void main() {
  test('tracks sort: route timeEnd before addedAt', () {
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
    );

    final list = [olderRide, noDate, newerRide]..sort(compareTracksNewestFirst);

    expect(list.map((t) => t.id).toList(), ['b', 'a', 'c']);
  });

  test('tracks sort: addedAt when no route timestamps', () {
    final older = MapTrack(
      id: 'a',
      name: 'old',
      sourceId: 'rides',
      points: const [
        TrackPoint(latitude: 1, longitude: 1),
        TrackPoint(latitude: 2, longitude: 2),
      ],
      addedAt: 1000,
    );
    final newer = MapTrack(
      id: 'b',
      name: 'new',
      sourceId: 'rides',
      points: const [
        TrackPoint(latitude: 3, longitude: 3),
        TrackPoint(latitude: 4, longitude: 4),
      ],
      addedAt: 2000,
    );

    final list = [older, newer]..sort(compareTracksNewestFirst);
    expect(list.map((t) => t.id).toList(), ['b', 'a']);
  });
}
