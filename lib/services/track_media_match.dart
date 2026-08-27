import 'dart:math' as math;

import 'package:latlong2/latlong.dart';

import '../models/library_media.dart';
import '../models/map_track.dart';
import 'geo.dart';

/// İz üzerindeki medya: mesafe (segment) + zaman toleransı.
const trackMediaMaxMeters = 2500.0;
const trackMediaTimePad = Duration(hours: 2);

/// Noktanın polyline’a en yakın mesafesi (metre) — yalnızca nokta değil segment.
double distanceToTrackMeters(LatLng point, List<LatLng> trackPoints) {
  if (trackPoints.isEmpty) return double.infinity;
  if (trackPoints.length == 1) {
    return distanceMeters(point, trackPoints.first);
  }
  var best = double.infinity;
  for (var i = 0; i < trackPoints.length - 1; i++) {
    final d = _distanceToSegmentMeters(point, trackPoints[i], trackPoints[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

double _distanceToSegmentMeters(LatLng p, LatLng a, LatLng b) {
  // Yerel metre düzlemi (kısa segmentler için yeterli).
  final lat0 = p.latitude * math.pi / 180;
  final mx = 111320.0 * math.cos(lat0);
  final my = 110540.0;
  final px = p.longitude * mx;
  final py = p.latitude * my;
  final ax = a.longitude * mx;
  final ay = a.latitude * my;
  final bx = b.longitude * mx;
  final by = b.latitude * my;
  final abx = bx - ax;
  final aby = by - ay;
  final apx = px - ax;
  final apy = py - ay;
  final ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-6) {
    return distanceMeters(p, a);
  }
  var t = (apx * abx + apy * aby) / ab2;
  t = t.clamp(0.0, 1.0);
  final cx = ax + abx * t;
  final cy = ay + aby * t;
  final dx = px - cx;
  final dy = py - cy;
  return math.sqrt(dx * dx + dy * dy);
}

bool isNearTrack(
  LatLng point,
  List<LatLng> trackPoints, {
  double maxMeters = trackMediaMaxMeters,
}) {
  if (trackPoints.isEmpty) return false;
  // Hızlı reddet: bounding box.
  var south = trackPoints.first.latitude;
  var north = south;
  var west = trackPoints.first.longitude;
  var east = west;
  for (final t in trackPoints) {
    south = math.min(south, t.latitude);
    north = math.max(north, t.latitude);
    west = math.min(west, t.longitude);
    east = math.max(east, t.longitude);
  }
  final padDeg = maxMeters / 111320.0 * 1.2;
  if (point.latitude < south - padDeg ||
      point.latitude > north + padDeg ||
      point.longitude < west - padDeg * 2 ||
      point.longitude > east + padDeg * 2) {
    return false;
  }
  return distanceToTrackMeters(point, trackPoints) <= maxMeters;
}

/// Eski API — nokta tarama; yeni kod [isNearTrack] kullansın.
bool isNearTrackPoints(
  LatLng point,
  List<LatLng> trackPoints, {
  double maxMeters = trackMediaMaxMeters,
}) =>
    isNearTrack(point, trackPoints, maxMeters: maxMeters);

bool trackContainsTime(
  MapTrack track,
  DateTime when, {
  Duration pad = trackMediaTimePad,
}) {
  final startMs = track.timeStart;
  final endMs = track.timeEnd;
  if (startMs == null || endMs == null) return false;
  final start = DateTime.fromMillisecondsSinceEpoch(startMs, isUtc: true)
      .toLocal()
      .subtract(pad);
  final end = DateTime.fromMillisecondsSinceEpoch(endMs, isUtc: true)
      .toLocal()
      .add(pad);
  return !when.isBefore(start) && !when.isAfter(end);
}

/// İz zamanına göre konum (GPS’siz GoPro / foto için).
LatLng? interpolateTrackAtTime(MapTrack track, DateTime when) {
  final pts = [
    for (final p in track.points)
      if (isValidGps(p.latitude, p.longitude) && p.timeMs != null) p,
  ];
  if (pts.isEmpty) return null;
  if (pts.length == 1) return pts.first.latLng;

  final tMs = when.toUtc().millisecondsSinceEpoch;
  if (tMs <= pts.first.timeMs!) return pts.first.latLng;
  if (tMs >= pts.last.timeMs!) return pts.last.latLng;

  for (var i = 0; i < pts.length - 1; i++) {
    final a = pts[i];
    final b = pts[i + 1];
    final ta = a.timeMs!;
    final tb = b.timeMs!;
    if (tMs < ta || tMs > tb) continue;
    if (tb == ta) return a.latLng;
    final f = (tMs - ta) / (tb - ta);
    return LatLng(
      a.latitude + (b.latitude - a.latitude) * f,
      a.longitude + (b.longitude - a.longitude) * f,
    );
  }
  return pts[pts.length ~/ 2].latLng;
}

List<LatLng> trackLatLngs(MapTrack track) => [
      for (final p in track.points)
        if (isValidGps(p.latitude, p.longitude)) p.latLng,
    ];

/// Medya bu izlere uyuyor mu?
/// - GPS varsa: iz çizgisine yakınlık (segment, ~2.5 km)
/// - GPS yoksa: iz zaman aralığı (± pad) → haritada zamana yerleştirilir
bool mediaMatchesTracks(
  LibraryMedia media,
  List<MapTrack> tracks, {
  double maxMeters = trackMediaMaxMeters,
  Duration timePad = trackMediaTimePad,
}) {
  if (tracks.isEmpty) return false;
  final ll = media.latLng;
  if (ll != null) {
    for (final track in tracks) {
      final pts = trackLatLngs(track);
      if (isNearTrack(ll, pts, maxMeters: maxMeters)) return true;
    }
    return false;
  }
  final taken = media.takenAt;
  if (taken == null) return false;
  for (final track in tracks) {
    if (trackContainsTime(track, taken, pad: timePad)) return true;
  }
  return false;
}

/// Haritada gösterilecek konum: yakın GPS veya (GPS yoksa) zaman interpolasyonu.
LatLng? resolveMediaOnTracks(
  LibraryMedia media,
  List<MapTrack> tracks, {
  double maxMeters = trackMediaMaxMeters,
  Duration timePad = trackMediaTimePad,
}) {
  if (tracks.isEmpty) return null;
  final ll = media.latLng;
  if (ll != null) {
    for (final track in tracks) {
      final pts = trackLatLngs(track);
      if (isNearTrack(ll, pts, maxMeters: maxMeters)) return ll;
    }
    return null;
  }
  final taken = media.takenAt;
  if (taken == null) return null;
  for (final track in tracks) {
    if (!trackContainsTime(track, taken, pad: timePad)) continue;
    final pos = interpolateTrackAtTime(track, taken);
    if (pos != null) return pos;
  }
  return null;
}
