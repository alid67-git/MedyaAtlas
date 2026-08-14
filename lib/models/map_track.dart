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
