import 'dart:convert';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:medyaatlas/services/track_parse.dart';

void main() {
  test('parseGpxText reads trkpt and bounds', () {
    const gpx = '''
<?xml version="1.0"?>
<gpx>
  <trk><name>Demo</name>
    <trkseg>
      <trkpt lat="41.0" lon="29.0"><time>2024-01-01T10:00:00Z</time></trkpt>
      <trkpt lat="41.1" lon="29.1"><time>2024-01-01T10:01:00Z</time></trkpt>
      <trkpt lat="41.2" lon="29.2"></trkpt>
    </trkseg>
  </trk>
</gpx>
''';
    final track = parseGpxText(gpx, name: 'demo.gpx', sourceId: 'rides');
    expect(track, isNotNull);
    expect(track!.points.length, 3);
    expect(track.points.first.latitude, 41.0);
    expect(track.points.first.longitude, 29.0);
    expect(track.bounds, isNotNull);
    expect(track.bounds!.south, closeTo(41.0, 1e-9));
    expect(track.bounds!.north, closeTo(41.2, 1e-9));
    expect(track.pointCount, 3);
  });

  test('parseKmlText reads coordinates', () {
    const kml = '''
<?xml version="1.0"?>
<kml><Document>
  <Placemark>
    <LineString>
      <coordinates>
        29.0,41.0,0 29.1,41.1,10 29.2,41.2,20
      </coordinates>
    </LineString>
  </Placemark>
</Document></kml>
''';
    final track = parseKmlText(kml, name: 'demo.kml', sourceId: 'rides');
    expect(track, isNotNull);
    expect(track!.points.length, 3);
    expect(track.points[1].elevation, 10);
  });

  test('parseTrackBytes handles kmz zip with kml', () {
    final kml = utf8.encode('''
<kml><Placemark><LineString>
  <coordinates>28.9,40.9 29.0,41.0</coordinates>
</LineString></Placemark></kml>
''');
    final archive = Archive()
      ..addFile(ArchiveFile('doc.kml', kml.length, kml));
    final kmz = ZipEncoder().encode(archive);
    expect(kmz, isNotNull);
    final track = parseTrackBytes(
      fileName: 'trip.kmz',
      bytes: Uint8List.fromList(kmz!),
    );
    expect(track, isNotNull);
    expect(track!.points.length, 2);
  });

  test('parseGpxText accepts XML namespace prefixes', () {
    const gpx = '''
<?xml version="1.0"?>
<gpx:gpx xmlns:gpx="http://www.topografix.com/GPX/1/1">
  <gpx:trk>
    <gpx:trkseg>
      <gpx:trkpt lat="40.0" lon="28.0"><gpx:ele>10</gpx:ele></gpx:trkpt>
      <gpx:trkpt lat="40.1" lon="28.1"><gpx:ele>12</gpx:ele></gpx:trkpt>
    </gpx:trkseg>
  </gpx:trk>
</gpx:gpx>
''';
    final track = parseGpxText(gpx, name: 'ns.gpx', sourceId: 'rides');
    expect(track, isNotNull);
    expect(track!.points.length, 2);
    expect(track.points.first.elevation, 10);
  });

  test('isTrackFileName', () {
    expect(isTrackFileName('a.gpx'), isTrue);
    expect(isTrackFileName('b.KML'), isTrue);
    expect(isTrackFileName('c.kmz'), isTrue);
    expect(isTrackFileName('d.jpg'), isFalse);
  });
}
