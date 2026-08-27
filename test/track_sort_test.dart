import 'package:flutter_test/flutter_test.dart';
import 'package:medyaatlas/models/map_track.dart';

void main() {
  test('tracks sort: newest addedAt first', () {
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
    final noDate = MapTrack(
      id: 'c',
      name: 'legacy',
      sourceId: 'rides',
      points: const [
        TrackPoint(latitude: 5, longitude: 5),
        TrackPoint(latitude: 6, longitude: 6),
      ],
    );

    final list = [older, noDate, newer];
    list.sort((a, b) {
      final aa = a.addedAt ?? 0;
      final bb = b.addedAt ?? 0;
      final byDate = bb.compareTo(aa);
      if (byDate != 0) return byDate;
      return b.name.toLowerCase().compareTo(a.name.toLowerCase());
    });

    expect(list.map((t) => t.id).toList(), ['b', 'a', 'c']);
  });
}
