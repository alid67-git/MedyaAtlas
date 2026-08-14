import 'package:latlong2/latlong.dart';

enum MediaKind { photo, video, gopro, drone }

/// MedyaAtlas tarama kimliği: kaynak + göreli yol + boyut.
String mediaIndexId({
  required String sourceId,
  required String relativePath,
  required int size,
}) =>
    '$sourceId|$relativePath|$size';

/// Yerel kütüphanedeki bir medya kaydı (Hive indeks).
class LibraryMedia {
  const LibraryMedia({
    required this.id,
    required this.name,
    required this.addedAt,
    required this.kind,
    required this.sourceId,
    this.relativePath,
    this.lat,
    this.lng,
    this.takenAt,
    this.locationMissing = false,
    this.localPath,
    this.sizeBytes,
  });

  final String id;
  final String name;
  final DateTime addedAt;
  final MediaKind kind;
  final String sourceId;
  final String? relativePath;
  final double? lat;
  final double? lng;
  final DateTime? takenAt;
  final bool locationMissing;
  final String? localPath;
  final int? sizeBytes;

  bool get isVideo => kind != MediaKind.photo;
  bool get hasLocation =>
      !locationMissing &&
      lat != null &&
      lng != null &&
      !(lat == 0 && lng == 0);
  LatLng? get latLng => hasLocation ? LatLng(lat!, lng!) : null;

  LibraryMedia copyWith({
    double? lat,
    double? lng,
    DateTime? takenAt,
    bool? locationMissing,
    String? localPath,
  }) =>
      LibraryMedia(
        id: id,
        name: name,
        addedAt: addedAt,
        kind: kind,
        sourceId: sourceId,
        relativePath: relativePath,
        lat: lat ?? this.lat,
        lng: lng ?? this.lng,
        takenAt: takenAt ?? this.takenAt,
        locationMissing: locationMissing ?? this.locationMissing,
        localPath: localPath ?? this.localPath,
        sizeBytes: sizeBytes,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'addedAt': addedAt.toIso8601String(),
        'kind': kind.name,
        'sourceId': sourceId,
        'relativePath': relativePath,
        'lat': lat,
        'lng': lng,
        'takenAt': takenAt?.toIso8601String(),
        'locationMissing': locationMissing,
        'localPath': localPath,
        'sizeBytes': sizeBytes,
      };

  factory LibraryMedia.fromJson(Map<String, dynamic> json) {
    final kindName = json['kind'] as String? ?? json['type'] as String? ?? 'photo';
    return LibraryMedia(
      id: json['id'] as String,
      name: json['name'] as String? ?? 'medya',
      addedAt: DateTime.parse(json['addedAt'] as String),
      kind: MediaKind.values.firstWhere(
        (k) => k.name == kindName,
        orElse: () => MediaKind.photo,
      ),
      sourceId: json['sourceId'] as String? ?? 'imported',
      relativePath: json['relativePath'] as String?,
      lat: (json['lat'] as num?)?.toDouble(),
      lng: (json['lng'] as num?)?.toDouble(),
      takenAt: json['takenAt'] != null
          ? DateTime.tryParse(json['takenAt'] as String)
          : null,
      locationMissing: json['locationMissing'] as bool? ?? false,
      localPath: json['localPath'] as String?,
      sizeBytes: json['sizeBytes'] as int?,
    );
  }
}

class MediaSource {
  const MediaSource({
    required this.id,
    required this.label,
    required this.addedAt,
    this.hidden = false,
  });

  final String id;
  final String label;
  final DateTime addedAt;
  final bool hidden;

  MediaSource copyWith({bool? hidden, String? label}) => MediaSource(
        id: id,
        label: label ?? this.label,
        addedAt: addedAt,
        hidden: hidden ?? this.hidden,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'label': label,
        'addedAt': addedAt.toIso8601String(),
        'hidden': hidden,
      };

  factory MediaSource.fromJson(Map<String, dynamic> json) => MediaSource(
        id: json['id'] as String,
        label: json['label'] as String? ?? 'kaynak',
        addedAt: DateTime.tryParse(json['addedAt'] as String? ?? '') ??
            DateTime.now(),
        hidden: json['hidden'] as bool? ?? false,
      );
}

class LocationCluster {
  const LocationCluster({
    required this.id,
    required this.latitude,
    required this.longitude,
    required this.items,
  });

  final String id;
  final double latitude;
  final double longitude;
  final List<LibraryMedia> items;

  LatLng get latLng => LatLng(latitude, longitude);
}
