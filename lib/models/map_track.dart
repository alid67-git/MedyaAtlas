import 'package:latlong2/latlong.dart';

class TrackPoint {
  const TrackPoint({
    required this.latitude,
    required this.longitude,
    this.elevation,
    this.timeMs,
  });

  final double latitude;
  final double longitude;
  final double? elevation;
  final int? timeMs;

  LatLng get latLng => LatLng(latitude, longitude);

  Map<String, dynamic> toJson() => {
        'lat': latitude,
        'lng': longitude,
        if (elevation != null) 'ele': elevation,
        if (timeMs != null) 't': timeMs,
      };

  factory TrackPoint.fromJson(Map<String, dynamic> json) => TrackPoint(
        latitude: (json['lat'] as num).toDouble(),
        longitude: (json['lng'] as num).toDouble(),
        elevation: (json['ele'] as num?)?.toDouble(),
        timeMs: (json['t'] as num?)?.toInt(),
      );
}

class TrackWaypoint {
  const TrackWaypoint({
    required this.latitude,
    required this.longitude,
    this.name,
  });

  final double latitude;
  final double longitude;
  final String? name;

  Map<String, dynamic> toJson() => {
        'lat': latitude,
        'lng': longitude,
        if (name != null) 'name': name,
      };

  factory TrackWaypoint.fromJson(Map<String, dynamic> json) => TrackWaypoint(
        latitude: (json['lat'] as num).toDouble(),
        longitude: (json['lng'] as num).toDouble(),
        name: json['name'] as String?,
      );
}

class TrackBounds {
  const TrackBounds({
    required this.south,
    required this.west,
    required this.north,
    required this.east,
  });

  final double south;
  final double west;
  final double north;
  final double east;

  Map<String, dynamic> toJson() => {
        's': south,
        'w': west,
        'n': north,
        'e': east,
      };

  factory TrackBounds.fromJson(Map<String, dynamic> json) => TrackBounds(
        south: (json['s'] as num).toDouble(),
        west: (json['w'] as num).toDouble(),
        north: (json['n'] as num).toDouble(),
        east: (json['e'] as num).toDouble(),
      );
}

class MapTrack {
  const MapTrack({
    required this.id,
    required this.name,
    required this.sourceId,
    required this.points,
    this.pointCount,
    this.waypoints,
    this.timeStart,
    this.timeEnd,
    this.bounds,
    this.visible = true,
    this.addedAt,
  });

  final String id;
  final String name;
  final String sourceId;
  final List<TrackPoint> points;
  final int? pointCount;
  final List<TrackWaypoint>? waypoints;
  final int? timeStart;
  final int? timeEnd;
  final TrackBounds? bounds;
  final bool visible;
  final int? addedAt;

  MapTrack copyWith({bool? visible, String? name}) => MapTrack(
        id: id,
        name: name ?? this.name,
        sourceId: sourceId,
        points: points,
        pointCount: pointCount,
        waypoints: waypoints,
        timeStart: timeStart,
        timeEnd: timeEnd,
        bounds: bounds,
        visible: visible ?? this.visible,
        addedAt: addedAt,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'sourceId': sourceId,
        'points': points.map((p) => p.toJson()).toList(),
        'pointCount': pointCount,
        'waypoints': waypoints?.map((w) => w.toJson()).toList(),
        'timeStart': timeStart,
        'timeEnd': timeEnd,
        'bounds': bounds?.toJson(),
        'visible': visible,
        'addedAt': addedAt,
      };

  factory MapTrack.fromJson(Map<String, dynamic> json) => MapTrack(
        id: json['id'] as String,
        name: json['name'] as String? ?? 'ride',
        sourceId: json['sourceId'] as String? ?? 'ride',
        points: (json['points'] as List<dynamic>? ?? [])
            .map((e) => TrackPoint.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList(),
        pointCount: json['pointCount'] as int?,
        waypoints: (json['waypoints'] as List<dynamic>?)
            ?.map(
              (e) => TrackWaypoint.fromJson(Map<String, dynamic>.from(e as Map)),
            )
            .toList(),
        timeStart: (json['timeStart'] as num?)?.toInt(),
        timeEnd: (json['timeEnd'] as num?)?.toInt(),
        bounds: json['bounds'] != null
            ? TrackBounds.fromJson(Map<String, dynamic>.from(json['bounds'] as Map))
            : null,
        visible: json['visible'] as bool? ?? true,
        addedAt: (json['addedAt'] as num?)?.toInt(),
      );
}

/// GPX/KML noktalarından en geç zaman (ms).
int? maxTrackPointTimeMs(List<TrackPoint> points) {
  int? max;
  for (final p in points) {
    final t = p.timeMs;
    if (t == null) continue;
    if (max == null || t > max) max = t;
  }
  return max;
}

/// GPX/KML noktalarından en erken zaman (ms).
int? minTrackPointTimeMs(List<TrackPoint> points) {
  int? min;
  for (final p in points) {
    final t = p.timeMs;
    if (t == null) continue;
    if (min == null || t < min) min = t;
  }
  return min;
}

/// Rota içi aktivite zamanı — bitiş, yoksa başlangıç (yükleme tarihi değil).
int? trackActivityEpochMs(MapTrack track) {
  final end = track.timeEnd ?? maxTrackPointTimeMs(track.points);
  if (end != null) return end;
  return track.timeStart ?? minTrackPointTimeMs(track.points);
}

/// İz listesi sırası: yalnızca rota verisi; tarihsiz rotalar sonda.
int trackSortEpochMs(MapTrack track) => trackActivityEpochMs(track) ?? 0;

/// Yeniden eskiye; eşitse ada göre (Z→A).
int compareTracksNewestFirst(MapTrack a, MapTrack b) {
  final byDate = trackSortEpochMs(b).compareTo(trackSortEpochMs(a));
  if (byDate != 0) return byDate;
  return b.name.toLowerCase().compareTo(a.name.toLowerCase());
}

/// Yinelenen yükleme kontrolü — UUID farklı olsa bile aynı rota.
String trackContentKey(MapTrack t) {
  final b = t.bounds;
  final n = t.pointCount ?? t.points.length;
  final first = t.points.isEmpty ? null : t.points.first;
  final last = t.points.isEmpty ? null : t.points.last;
  String fmt(double v) => v.toStringAsFixed(5);
  return [
    t.name.trim().toLowerCase(),
    '$n',
    if (b != null)
      '${fmt(b.south)},${fmt(b.west)},${fmt(b.north)},${fmt(b.east)}',
    if (first != null) '${fmt(first.latitude)},${fmt(first.longitude)}',
    if (last != null) '${fmt(last.latitude)},${fmt(last.longitude)}',
    '${t.timeStart ?? ''}-${t.timeEnd ?? ''}',
  ].join('|');
}
