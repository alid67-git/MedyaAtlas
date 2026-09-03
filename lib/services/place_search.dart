import 'dart:convert';

import 'package:http/http.dart' as http;

class PlaceHit {
  const PlaceHit({
    required this.id,
    required this.label,
    required this.latitude,
    required this.longitude,
    this.bbox,
  });

  final String id;
  final String label;
  final double latitude;
  final double longitude;

  /// south, north, west, east
  final List<double>? bbox;
}

Future<List<PlaceHit>> searchPlaces(String query) async {
  final q = query.trim();
  if (q.length < 2) return [];
  final uri = Uri.https('nominatim.openstreetmap.org', '/search', {
    'q': q,
    'format': 'json',
    'limit': '6',
    'addressdetails': '0',
  });
  try {
    final res = await http.get(
      uri,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'MedyaAtlas/0.6',
      },
    );
    if (res.statusCode != 200) return [];
    final data = jsonDecode(res.body) as List<dynamic>;
    final hits = <PlaceHit>[];
    for (final row in data) {
      final map = Map<String, dynamic>.from(row as Map);
      final lat = double.tryParse('${map['lat']}');
      final lon = double.tryParse('${map['lon']}');
      if (lat == null ||
          lon == null ||
          !lat.isFinite ||
          !lon.isFinite ||
          lat.abs() > 90 ||
          lon.abs() > 180) {
        continue;
      }
      List<double>? bbox;
      final box = map['boundingbox'];
      if (box is List && box.length == 4) {
        final south = double.tryParse('${box[0]}');
        final north = double.tryParse('${box[1]}');
        final west = double.tryParse('${box[2]}');
        final east = double.tryParse('${box[3]}');
        if (south != null &&
            north != null &&
            west != null &&
            east != null &&
            south.isFinite &&
            north.isFinite &&
            west.isFinite &&
            east.isFinite) {
          bbox = [south, north, west, east];
        }
      }
      hits.add(
        PlaceHit(
          id: 'place-${map['place_id']}',
          label: '${map['display_name']}',
          latitude: lat,
          longitude: lon,
          bbox: bbox,
        ),
      );
    }
    return hits;
  } catch (_) {
    return [];
  }
}
