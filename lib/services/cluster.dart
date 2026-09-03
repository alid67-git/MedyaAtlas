import 'dart:math' as math;

import '../models/library_media.dart';
import 'geo.dart';

double haversineMeters(double lat1, double lon1, double lat2, double lon2) {
  const r = 6371000.0;
  double toRad(double d) => d * math.pi / 180;
  final dLat = toRad(lat2 - lat1);
  final dLon = toRad(lon2 - lon1);
  final a = math.pow(math.sin(dLat / 2), 2) +
      math.cos(toRad(lat1)) * math.cos(toRad(lat2)) * math.pow(math.sin(dLon / 2), 2);
  return 2 * r * math.asin(math.sqrt(a.toDouble()));
}

/// PC MedyaAtlas V2: ~40 m yarıçap.
List<LocationCluster> groupByLocation(
  List<LibraryMedia> items, {
  double radiusMeters = 40,
}) {
  final clusters = <LocationCluster>[];
  for (final item in items) {
    if (!item.hasLocation) continue;
    if (!isValidGps(item.lat, item.lng)) continue;
    var nearest = -1;
    var nearestDist = double.infinity;
    for (var i = 0; i < clusters.length; i++) {
      final c = clusters[i];
      final d = haversineMeters(item.lat!, item.lng!, c.latitude, c.longitude);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    }
    if (nearest >= 0 && nearestDist <= radiusMeters) {
      final c = clusters[nearest];
      final nextItems = [...c.items, item];
      final n = nextItems.length;
      final lat = nextItems.fold<double>(0, (s, x) => s + x.lat!) / n;
      final lng = nextItems.fold<double>(0, (s, x) => s + x.lng!) / n;
      if (!isValidGps(lat, lng)) continue;
      clusters[nearest] = LocationCluster(
        id: c.id,
        latitude: lat,
        longitude: lng,
        items: nextItems,
      );
    } else {
      clusters.add(
        LocationCluster(
          id: 'loc-${clusters.length}-${item.id}',
          latitude: item.lat!,
          longitude: item.lng!,
          items: [item],
        ),
      );
    }
  }
  return clusters;
}
