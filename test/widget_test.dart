import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:medyaatlas/models/library_media.dart';
import 'package:medyaatlas/models/map_track.dart';
import 'package:medyaatlas/services/cluster.dart';
import 'package:medyaatlas/services/geo.dart';
import 'package:medyaatlas/services/header_gps.dart';
import 'package:medyaatlas/services/media_kind.dart';

LibraryMedia _photo({
  required String id,
  required double lat,
  required double lng,
  String sourceId = 'gallery',
}) {
  return LibraryMedia(
    id: id,
    name: '$id.jpg',
    addedAt: DateTime.utc(2026, 8, 13),
    kind: MediaKind.photo,
    sourceId: sourceId,
    lat: lat,
    lng: lng,
  );
}

void main() {
  test('LibraryMedia JSON roundtrip', () {
    final media = LibraryMedia(
      id: 'a',
      name: 'foto.jpg',
      addedAt: DateTime.utc(2026, 8, 12),
      kind: MediaKind.photo,
      sourceId: 'gallery',
      lat: 41.0,
      lng: 29.0,
    );
    final copy = LibraryMedia.fromJson(media.toJson());
    expect(copy.id, 'a');
    expect(copy.kind, MediaKind.photo);
    expect(copy.sourceId, 'gallery');
    expect(copy.hasLocation, isTrue);
    expect(copy.lat, 41.0);
  });

  test('eski type alanı kind olarak okunur', () {
    final copy = LibraryMedia.fromJson({
      'id': 'b',
      'name': 'clip.mp4',
      'addedAt': '2026-08-12T00:00:00.000Z',
      'type': 'video',
    });
    expect(copy.kind, MediaKind.video);
    expect(copy.hasLocation, isFalse);
    expect(copy.locationMissing, isFalse);
  });

  test('NaN/Infinity GPS jsonEncode kırılmaz ve hasLocation false', () {
    final media = LibraryMedia(
      id: 'bad',
      name: 'x.jpg',
      addedAt: DateTime.utc(2026, 8, 12),
      kind: MediaKind.photo,
      sourceId: 'gallery',
      lat: double.nan,
      lng: double.infinity,
      locationMissing: false,
    );
    expect(media.hasLocation, isFalse);
    expect(isValidGps(media.lat, media.lng), isFalse);
    final json = media.toJson();
    expect(json['lat'], isNull);
    expect(json['lng'], isNull);
  });

  test('isValidGps 0,0 ve sınır dışı reddeder', () {
    expect(isValidGps(0, 0), isFalse);
    expect(isValidGps(91, 29), isFalse);
    expect(isValidGps(41, 181), isFalse);
    expect(isValidGps(41.0, 29.0), isTrue);
  });

  test('MediaSource JSON roundtrip', () {
    final source = MediaSource(
      id: 's1',
      label: 'GoPro',
      addedAt: DateTime.utc(2026, 8, 1),
      hidden: true,
    );
    final copy = MediaSource.fromJson(source.toJson());
    expect(copy.id, 's1');
    expect(copy.label, 'GoPro');
    expect(copy.hidden, isTrue);
  });

  test('groupByLocation 40 m yarıçap', () {
    final items = [
      _photo(id: '1', lat: 41.0082, lng: 28.9784),
      _photo(id: '2', lat: 41.0083, lng: 28.9785),
      _photo(id: '3', lat: 41.05, lng: 29.05),
    ];
    final clusters = groupByLocation(items);
    expect(clusters.length, 2);
    expect(clusters.map((c) => c.items.length).toSet(), {2, 1});
  });

  test('groupByLocation NaN pin eklemez', () {
    final items = [
      LibraryMedia(
        id: 'n',
        name: 'n.jpg',
        addedAt: DateTime.utc(2026, 8, 13),
        kind: MediaKind.photo,
        sourceId: 'gallery',
        lat: double.nan,
        lng: 29,
      ),
      _photo(id: 'ok', lat: 41, lng: 29),
    ];
    final clusters = groupByLocation(items);
    expect(clusters.length, 1);
    expect(clusters.single.items.single.id, 'ok');
  });

  test('detectKind GoPro ve DJI', () {
    expect(detectKind('GX010123.MP4'), MediaKind.gopro);
    expect(detectKind('GH010123.mp4'), MediaKind.gopro);
    expect(detectKind('DJI_0123.MP4'), MediaKind.drone);
    expect(detectKind('tatil.jpg'), MediaKind.photo);
    expect(detectKind('clip.MOV'), MediaKind.video);
    expect(detectKind('film.mkv'), MediaKind.video);
    expect(detectKind('film.flv'), MediaKind.video);
    expect(detectKind('notlar.txt'), isNull);
    expect(detectKind('proxy.lrv'), isNull);
  });

  test('kindCountsLabel özet', () {
    expect(
      kindCountsLabel({
        MediaKind.photo: 3,
        MediaKind.video: 2,
        MediaKind.gopro: 1,
        MediaKind.drone: 0,
      }),
      '3 foto · 2 video · 1 GoPro',
    );
  });

  test('isMediaName foto ve video', () {
    expect(isMediaName('a.JPG'), isTrue);
    expect(isMediaName('b.mp4'), isTrue);
    expect(isMediaName('c.mov'), isTrue);
    expect(isMediaName('d.lrv'), isFalse);
    expect(isMediaName('e.txt'), isFalse);
  });

  test('ISO6709 ve ©xyz başlık GPS', () {
    final iso = parseIso6709('+41.0082+028.9784/');
    expect(iso, isNotNull);
    expect(iso!.latitude, closeTo(41.0082, 0.0001));
    expect(iso.longitude, closeTo(28.9784, 0.0001));
    expect(parseIso6709('degil'), isNull);

    final xyz = <int>[
      0xA9, 0x78, 0x79, 0x7A,
      0, 0, 0, 0,
      ...'+48.8577+002.2950/'.codeUnits,
    ];
    final point = extractHeaderGps(Uint8List.fromList(xyz));
    expect(point, isNotNull);
    expect(point!.latitude, closeTo(48.8577, 0.0001));
  });

  test('mediaIndexId MedyaAtlas biçimi', () {
    expect(
      mediaIndexId(sourceId: 's', relativePath: 'a/b.mp4', size: 12),
      's|a/b.mp4|12',
    );
  });

  test('MapTrack JSON roundtrip', () {
    final track = MapTrack(
      id: 't1',
      name: 'ride',
      sourceId: 'gpx',
      points: const [
        TrackPoint(latitude: 41, longitude: 29, timeMs: 1),
      ],
    );
    final copy = MapTrack.fromJson(track.toJson());
    expect(copy.id, 't1');
    expect(copy.points.single.latitude, 41);
  });
}
