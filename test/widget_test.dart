import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:medyaatlas/models/library_media.dart';
import 'package:medyaatlas/models/map_track.dart';
import 'package:medyaatlas/services/app_updater.dart';
import 'package:medyaatlas/services/cluster.dart';
import 'package:medyaatlas/services/folder_types.dart';
import 'package:medyaatlas/services/geo.dart';
import 'package:medyaatlas/services/gpmf_gps.dart';
import 'package:medyaatlas/services/header_gps.dart';
import 'package:medyaatlas/services/media_groups.dart';
import 'package:medyaatlas/services/media_kind.dart';
import 'package:medyaatlas/services/scan_paths.dart';
import 'package:medyaatlas/services/video_gps.dart';
import 'package:medyaatlas/services/video_preview.dart';
import 'package:medyaatlas/services/volume_mount.dart';

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

  test('blob: localPath Hive indeksine yazılmaz', () {
    final media = LibraryMedia(
      id: 'blob',
      name: 'y.jpg',
      addedAt: DateTime.utc(2026, 8, 19),
      kind: MediaKind.photo,
      sourceId: 'gallery',
      localPath: 'blob:https://example.com/dead',
    );
    expect(media.toJson()['localPath'], isNull);
    expect(
      media.copyWith(clearLocalPath: true).localPath,
      isNull,
    );
  });

  test('isValidGps 0,0 ve sınır dışı reddeder', () {
    expect(isValidGps(0, 0), isFalse);
    expect(isValidGps(91, 29), isFalse);
    expect(isValidGps(41, 181), isFalse);
    expect(isValidGps(41.0, 29.0), isTrue);
  });

  test('isNearTrackPoints koridor mesafesi', () {
    final track = [
      const LatLng(41.0, 29.0),
      const LatLng(41.01, 29.01),
      const LatLng(41.02, 29.02),
    ];
    expect(
      isNearTrackPoints(const LatLng(41.001, 29.001), track, maxMeters: 450),
      isTrue,
    );
    expect(
      isNearTrackPoints(const LatLng(42.5, 30.5), track, maxMeters: 450),
      isFalse,
    );
  });

  test('MediaSource JSON roundtrip', () {
    final source = MediaSource(
      id: 's1',
      label: 'GoPro',
      addedAt: DateTime.utc(2026, 8, 1),
      hidden: true,
      rootPath: r'D:\Photos',
    );
    final copy = MediaSource.fromJson(source.toJson());
    expect(copy.id, 's1');
    expect(copy.label, 'GoPro');
    expect(copy.hidden, isTrue);
    expect(copy.rootPath, r'D:\Photos');
    expect(copy.isRemovableVolume, isTrue);
  });

  test('normalizeRootPath sürücü / klasör', () {
    expect(displayNameForRoot(r'D:\GoPro'), 'GoPro');
    expect(displayNameForRoot(r'D:/DCIM'), 'DCIM');
    expect(displayNameForRoot(r'E:\'), 'E');
    expect(displayNameForRoot('/media/usb/Photos'), 'Photos');
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
    expect(detectKind('GS010099.MP4'), MediaKind.gopro);
    expect(detectKind('DJI_0123.MP4'), MediaKind.drone);
    expect(detectKind('Osmo_001.MP4'), MediaKind.drone);
    expect(detectKind('tatil.jpg'), MediaKind.photo);
    expect(detectKind('clip.MOV'), MediaKind.video);
    expect(detectKind('film.mkv'), MediaKind.video);
    expect(detectKind('film.flv'), MediaKind.video);
    expect(detectKind('notlar.txt'), isNull);
    expect(detectKind('proxy.lrv'), isNull);
  });

  test('GPMF GPS5 ilk konum', () {
    // DEVC > STRM > SCAL + GPS5 (lat 41.0082, lon 28.9784, scale 1e7)
    final bytes = Uint8List.fromList([
      120, 120, 120, 120, 68, 69, 86, 67, 0, 64, 0, 1, 83, 84, 82, 77, 0, 56, 0,
      1, 83, 67, 65, 76, 108, 4, 0, 5, 0, 152, 150, 128, 0, 152, 150, 128, 0, 0,
      3, 232, 0, 0, 0, 100, 0, 0, 0, 100, 71, 80, 83, 53, 108, 20, 0, 1, 24, 113,
      90, 208, 17, 69, 192, 192, 0, 1, 134, 160, 0, 0, 0, 0, 0, 0, 0, 0, 121, 121,
      121, 121,
    ]);
    final point = extractGpmfGps(bytes);
    expect(point, isNotNull);
    expect(point!.latitude, closeTo(41.0082, 0.0001));
    expect(point.longitude, closeTo(28.9784, 0.0001));
  });

  test('DJI SRT konum ayrıştırma', () {
    const modern = '''
1
00:00:00,000 --> 00:00:00,033
[latitude: 41.008200] [longitude: 28.978400]
''';
    final a = parseDjiSrtGps(modern);
    expect(a, isNotNull);
    expect(a!.latitude, closeTo(41.0082, 0.0001));
    expect(a.longitude, closeTo(28.9784, 0.0001));

    const legacy = 'GPS(59.302335,18.203059,132.860)';
    final b = parseDjiSrtGps(legacy);
    expect(b, isNotNull);
    expect(b!.latitude, closeTo(59.302335, 0.0001));
    expect(b.longitude, closeTo(18.203059, 0.0001));
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

  test('largestJpegIn gömülü kapak bulur', () {
    final jpeg = Uint8List.fromList([
      0xFF, 0xD8, 0xFF, 0xE0,
      ...List<int>.filled(3000, 1),
      0xFF, 0xD9,
    ]);
    final padded = Uint8List.fromList([
      0, 1, 2, 3,
      ...jpeg,
      9, 9, 9,
    ]);
    final found = largestJpegIn(padded, minBytes: 100);
    expect(found, isNotNull);
    expect(found!.first, 0xFF);
    expect(found[1], 0xD8);
    expect(found.last, 0xD9);
  });

  test('compareVersions semver sırası', () {
    expect(compareVersions('0.7.3', '0.7.2'), 1);
    expect(compareVersions('0.7.2', '0.7.3'), -1);
    expect(compareVersions('0.7.3', '0.7.3'), 0);
    expect(compareVersions('1.0.0', '0.9.9'), 1);
    expect(compareVersions('v0.8.0', '0.7.3'), 1);
  });

  test('zorunlu güncelleme 2 sürüm geride', () {
    expect(
      versionsBehind(current: '1.0.5', latest: '1.0.5'),
      0,
    );
    expect(
      versionsBehind(current: '1.0.4', latest: '1.0.5'),
      1,
    );
    expect(
      versionsBehind(current: '1.0.3', latest: '1.0.5'),
      2,
    );
    expect(
      versionsBehind(current: '0.8.1', latest: '1.0.5'),
      999,
    );
    // Zorunlu güncelleme şimdilik kapalı (isteğe bağlı diyalog).
    expect(
      isForceUpdateRequired(current: '1.0.3', latest: '1.0.5'),
      isFalse,
    );
    expect(
      isForceUpdateRequired(current: '1.0.23', latest: '1.0.26'),
      isFalse,
    );
  });

  test('SD Android/data klasörleri atlanır', () {
    expect(
      shouldSkipScanDirectory('/storage/56A9-7F6A/Android/data'),
      isTrue,
    );
    expect(
      shouldSkipScanDirectory('/storage/56A9-7F6A/Android/obb'),
      isTrue,
    );
    expect(
      shouldSkipScanDirectory('/storage/56A9-7F6A/Android'),
      isTrue,
    );
    expect(
      shouldSkipScanDirectory('/storage/56A9-7F6A/DCIM/Camera'),
      isFalse,
    );
    expect(
      shouldSkipScanDirectory(r'D:\DCIM'),
      isFalse,
    );
    expect(shouldSkipScanDirectory(r'E:\$RECYCLE.BIN'), isTrue);
  });

  test('büyük diskte medya klasörleri önce', () {
    expect(mediaScanPriority('/mnt/disk/DCIM'), lessThan(mediaScanPriority('/mnt/disk/Docs')));
    expect(mediaScanPriority('/mnt/disk/GoPro'), 0);
    expect(mediaScanPriority(r'D:\GoPro'), 0);
    expect(mediaScanPriority('/mnt/disk/DJI_001'), 0);
    expect(mediaScanPriority('/mnt/disk/random'), greaterThan(0));
  });

  test('medya gün grupları ve özet etiket', () {
    final a = LibraryMedia(
      id: '1',
      name: 'a.jpg',
      addedAt: DateTime.utc(2026, 8, 1),
      kind: MediaKind.photo,
      sourceId: 's',
      takenAt: DateTime(2017, 7, 14, 10),
      lat: 41,
      lng: 29,
    );
    final b = LibraryMedia(
      id: '2',
      name: 'b.jpg',
      addedAt: DateTime.utc(2026, 8, 1),
      kind: MediaKind.photo,
      sourceId: 's',
      takenAt: DateTime(2017, 7, 14, 18),
      lat: 41,
      lng: 29,
    );
    final c = LibraryMedia(
      id: '3',
      name: 'c.mp4',
      addedAt: DateTime.utc(2026, 8, 1),
      kind: MediaKind.video,
      sourceId: 's',
      takenAt: DateTime(2017, 7, 9),
      lat: 41,
      lng: 29,
    );
    final groups = groupMediaByDay([a, b, c]);
    expect(groups.length, 2);
    expect(groups.first.items.length, 2);
    expect(mediaCountLabel([a, b, c]), '3 medya');
    expect(mediaCountLabel([a, b]), '2 fotoğraf');
    expect(mediaDateRangeLabel([a, c]), contains('2017'));
    expect(coverMediaOf([c, a]).id, '1');
  });

  test('bulk GPS video head GoPro için daha büyük', () {
    expect(bulkGpsVideoHeadBytes, greaterThan(bulkVideoHeadBytes));
  });
}
