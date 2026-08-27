import 'package:flutter_test/flutter_test.dart';
import 'package:medyaatlas/models/library_media.dart';
import 'package:medyaatlas/services/media_kind.dart';

void main() {
  group('detectKind', () {
    test('GX###### phone library → video, not GoPro', () {
      expect(
        detectKind('GX012489.MP4', phoneLibrary: true),
        MediaKind.video,
      );
      expect(
        detectKind('GH011234.MP4', phoneLibrary: true),
        MediaKind.video,
      );
    });

    test('GX###### outside phone → GoPro (folder import)', () {
      expect(detectKind('GX012489.MP4'), MediaKind.gopro);
    });

    test('strong GoPro names stay GoPro on phone', () {
      expect(
        detectKind('GOPR1234.MP4', phoneLibrary: true),
        MediaKind.gopro,
      );
      expect(
        detectKind('GoPro_hero.MP4', phoneLibrary: true),
        MediaKind.gopro,
      );
    });

    test('plain phone video', () {
      expect(
        detectKind('VID_20240101.mp4', phoneLibrary: true),
        MediaKind.video,
      );
    });
  });
}
