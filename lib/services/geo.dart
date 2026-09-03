import 'dart:math' as math;

import 'package:latlong2/latlong.dart';

/// JSON / harita için geçerli GPS: sonlu, 0,0 değil, dünya sınırları içinde.
bool isValidGps(double? lat, double? lng) {
  if (lat == null || lng == null) return false;
  if (!lat.isFinite || !lng.isFinite) return false;
  if (lat == 0 && lng == 0) return false;
  if (lat.abs() > 90 || lng.abs() > 180) return false;
  return true;
}

LatLng? latLngOrNull(double? lat, double? lng) =>
    isValidGps(lat, lng) ? LatLng(lat!, lng!) : null;

/// İki nokta arası metre (haversine).
double distanceMeters(LatLng a, LatLng b) {
  const r = 6371000.0;
  final lat1 = a.latitude * math.pi / 180;
  final lat2 = b.latitude * math.pi / 180;
  final dLat = (b.latitude - a.latitude) * math.pi / 180;
  final dLon = (b.longitude - a.longitude) * math.pi / 180;
  final h = math.sin(dLat / 2) * math.sin(dLat / 2) +
      math.cos(lat1) * math.cos(lat2) * math.sin(dLon / 2) * math.sin(dLon / 2);
  return 2 * r * math.asin(math.sqrt(h.clamp(0.0, 1.0)));
}

/// Görüntüleme için gereksiz noktaları düşürür (analiz/export tam listeyi
/// kullanır): önce mesafeye göre inceltir (şekil/köşe bozulmaz), hâlâ
/// [maxPoints] üstündeyse indeks adımıyla son bir düşürme yapar. RideAtlas'taki
/// latLngsForMapDisplay ile aynı yaklaşım — sabit indeks-adımı tek başına
/// köşeleri silebiliyordu.
List<LatLng> simplifyLatLngsForDisplay(
  List<LatLng> points, {
  required int maxPoints,
  double minSpacingMeters = 15,
}) {
  if (points.length <= 2) return points;
  if (points.length <= maxPoints && minSpacingMeters <= 0) return points;

  bool samePoint(LatLng a, LatLng b) =>
      a.latitude == b.latitude && a.longitude == b.longitude;

  final spaced = <LatLng>[points.first];
  for (var i = 1; i < points.length - 1; i++) {
    final p = points[i];
    if (distanceMeters(spaced.last, p) >= minSpacingMeters) {
      spaced.add(p);
    }
  }
  final last = points.last;
  if (!samePoint(spaced.last, last)) spaced.add(last);

  if (spaced.length <= maxPoints) return spaced;

  final step = (spaced.length / maxPoints).ceil();
  final out = <LatLng>[spaced.first];
  for (var i = step; i < spaced.length - 1; i += step) {
    out.add(spaced[i]);
  }
  final spacedLast = spaced.last;
  if (!samePoint(out.last, spacedLast)) out.add(spacedLast);
  return out;
}

/// Medya, iz noktalarından birine [maxMeters] içinde mi?
bool isNearTrackPoints(
  LatLng point,
  List<LatLng> trackPoints, {
  double maxMeters = 400,
}) {
  if (trackPoints.isEmpty) return false;
  final maxDeg = maxMeters / 111320.0; // kaba lat derece
  for (final t in trackPoints) {
    final dLat = (t.latitude - point.latitude).abs();
    final dLon = (t.longitude - point.longitude).abs();
    if (dLat > maxDeg || dLon > maxDeg * 2) continue;
    if (distanceMeters(point, t) <= maxMeters) return true;
  }
  return false;
}
