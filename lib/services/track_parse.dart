import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:uuid/uuid.dart';

import '../models/map_track.dart';
import 'geo.dart';

const trackDisplayMaxPoints = 2500;

bool isTrackFileName(String name) =>
    RegExp(r'\.(gpx|kml|kmz)$', caseSensitive: false).hasMatch(name);

String trackFileDisplayName(String fileName) {
  final base = fileName.replaceAll(RegExp(r'^.*[/\\]'), '').trim();
  return base.isEmpty ? fileName : base;
}

List<TrackPoint> simplifyTrackPoints(
  List<TrackPoint> points, {
  int maxPoints = trackDisplayMaxPoints,
}) {
  if (points.length <= maxPoints) return points;
  final step = (points.length / maxPoints).ceil();
  final out = <TrackPoint>[];
  for (var i = 0; i < points.length; i += step) {
    out.add(points[i]);
  }
  final last = points.last;
  if (out.isEmpty ||
      out.last.latitude != last.latitude ||
      out.last.longitude != last.longitude) {
    out.add(last);
  }
  return out;
}

MapTrack finalizeTrack(
  MapTrack track, {
  int maxPoints = trackDisplayMaxPoints,
}) {
  final raw = track.points;
  if (raw.isEmpty) return track;

  var timeStart = track.timeStart;
  var timeEnd = track.timeEnd;
  var south = track.bounds?.south ?? 90.0;
  var north = track.bounds?.north ?? -90.0;
  var west = track.bounds?.west ?? 180.0;
  var east = track.bounds?.east ?? -180.0;
  final needMeta = timeStart == null ||
      timeEnd == null ||
      track.bounds == null ||
      track.pointCount == null ||
      raw.length > maxPoints;

  if (needMeta) {
    timeStart = null;
    timeEnd = null;
    south = 90;
    north = -90;
    west = 180;
    east = -180;
    for (final p in raw) {
      final t = p.timeMs;
      if (t != null) {
        final ts = timeStart;
        final te = timeEnd;
        timeStart = ts == null ? t : math.min(ts, t);
        timeEnd = te == null ? t : math.max(te, t);
      }
      south = math.min(south, p.latitude);
      north = math.max(north, p.latitude);
      west = math.min(west, p.longitude);
      east = math.max(east, p.longitude);
    }
  }

  return MapTrack(
    id: track.id,
    name: track.name,
    sourceId: track.sourceId,
    points: simplifyTrackPoints(raw, maxPoints: maxPoints),
    pointCount: track.pointCount ?? raw.length,
    waypoints: track.waypoints,
    timeStart: timeStart,
    timeEnd: timeEnd,
    bounds: TrackBounds(south: south, west: west, north: north, east: east),
    visible: track.visible,
    addedAt: track.addedAt,
  );
}

MapTrack? parseGpxText(String text, {required String name, required String sourceId}) {
  final points = <TrackPoint>[];
  final waypoints = <TrackWaypoint>[];
  final ptRe = RegExp(
    r'<(?:[\w.-]+:)?(?:trkpt|rtept)\b([^>]*)>([\s\S]*?)</(?:[\w.-]+:)?(?:trkpt|rtept)>',
    caseSensitive: false,
  );
  final wptRe = RegExp(
    r'<(?:[\w.-]+:)?wpt\b([^>]*)>([\s\S]*?)</(?:[\w.-]+:)?wpt>',
    caseSensitive: false,
  );
  final latRe = RegExp(r'''\blat\s*=\s*["']([^"']+)["']''', caseSensitive: false);
  final lonRe = RegExp(r'''\blon\s*=\s*["']([^"']+)["']''', caseSensitive: false);
  final eleRe = RegExp(
    r'<(?:[\w.-]+:)?ele\b[^>]*>([^<]+)</(?:[\w.-]+:)?ele>',
    caseSensitive: false,
  );
  final timeRe = RegExp(
    r'<(?:[\w.-]+:)?time\b[^>]*>([^<]+)</(?:[\w.-]+:)?time>',
    caseSensitive: false,
  );
  final nameRe = RegExp(
    r'<(?:[\w.-]+:)?name\b[^>]*>([^<]+)</(?:[\w.-]+:)?name>',
    caseSensitive: false,
  );

  for (final m in ptRe.allMatches(text)) {
    final attrs = m.group(1) ?? '';
    final body = m.group(2) ?? '';
    final lat = double.tryParse(latRe.firstMatch(attrs)?.group(1) ?? '');
    final lon = double.tryParse(lonRe.firstMatch(attrs)?.group(1) ?? '');
    if (!isValidGps(lat, lon)) continue;
    final ele = double.tryParse(eleRe.firstMatch(body)?.group(1)?.trim() ?? '');
    final timeRaw = timeRe.firstMatch(body)?.group(1)?.trim();
    final timeMs = timeRaw == null ? null : DateTime.tryParse(timeRaw)?.millisecondsSinceEpoch;
    points.add(
      TrackPoint(
        latitude: lat!,
        longitude: lon!,
        elevation: ele?.isFinite == true ? ele : null,
        timeMs: timeMs,
      ),
    );
  }

  for (final m in wptRe.allMatches(text)) {
    final attrs = m.group(1) ?? '';
    final body = m.group(2) ?? '';
    final lat = double.tryParse(latRe.firstMatch(attrs)?.group(1) ?? '');
    final lon = double.tryParse(lonRe.firstMatch(attrs)?.group(1) ?? '');
    if (!isValidGps(lat, lon)) continue;
    final wname = nameRe.firstMatch(body)?.group(1)?.trim();
    waypoints.add(
      TrackWaypoint(latitude: lat!, longitude: lon!, name: wname),
    );
  }

  if (points.length < 2) return null;
  return finalizeTrack(
    MapTrack(
      id: 'ride-${const Uuid().v4()}',
      name: trackFileDisplayName(name),
      sourceId: sourceId,
      points: points,
      waypoints: waypoints.isEmpty ? null : waypoints,
      visible: true,
      addedAt: DateTime.now().millisecondsSinceEpoch,
    ),
  );
}

List<TrackPoint> parseKmlCoordinates(String text) {
  final points = <TrackPoint>[];
  final re = RegExp(
    r'<(?:[\w.-]+:)?coordinates\b[^>]*>([\s\S]*?)</(?:[\w.-]+:)?coordinates>',
    caseSensitive: false,
  );
  for (final m in re.allMatches(text)) {
    final chunk = m.group(1) ?? '';
    for (final token in chunk.trim().split(RegExp(r'\s+'))) {
      if (token.isEmpty) continue;
      final parts = token.split(',');
      if (parts.length < 2) continue;
      final lon = double.tryParse(parts[0]);
      final lat = double.tryParse(parts[1]);
      final ele = parts.length > 2 ? double.tryParse(parts[2]) : null;
      if (!isValidGps(lat, lon)) continue;
      points.add(
        TrackPoint(
          latitude: lat!,
          longitude: lon!,
          elevation: ele?.isFinite == true ? ele : null,
        ),
      );
    }
  }
  return points;
}

MapTrack? parseKmlText(String text, {required String name, required String sourceId}) {
  final points = parseKmlCoordinates(text);
  if (points.length < 2) return null;
  return finalizeTrack(
    MapTrack(
      id: 'ride-${const Uuid().v4()}',
      name: trackFileDisplayName(name),
      sourceId: sourceId,
      points: points,
      visible: true,
      addedAt: DateTime.now().millisecondsSinceEpoch,
    ),
  );
}

String? kmlTextFromKmzBytes(Uint8List bytes) {
  try {
    final archive = ZipDecoder().decodeBytes(bytes);
    for (final file in archive.files) {
      if (!file.isFile) continue;
      if (!file.name.toLowerCase().endsWith('.kml')) continue;
      return utf8.decode(file.content, allowMalformed: true);
    }
  } catch (_) {}
  return null;
}

MapTrack? parseTrackBytes({
  required String fileName,
  required Uint8List bytes,
  String sourceId = 'rides',
}) {
  final lower = fileName.toLowerCase();
  try {
    if (lower.endsWith('.gpx')) {
      return parseGpxText(
        utf8.decode(bytes, allowMalformed: true),
        name: fileName,
        sourceId: sourceId,
      );
    }
    if (lower.endsWith('.kml')) {
      return parseKmlText(
        utf8.decode(bytes, allowMalformed: true),
        name: fileName,
        sourceId: sourceId,
      );
    }
    if (lower.endsWith('.kmz')) {
      final kml = kmlTextFromKmzBytes(bytes);
      if (kml == null) return null;
      return parseKmlText(kml, name: fileName, sourceId: sourceId);
    }
  } catch (_) {
    return null;
  }
  return null;
}
