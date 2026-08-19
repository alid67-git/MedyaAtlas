// ignore_for_file: avoid_web_libraries_in_flutter
import 'dart:js_interop';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:medyaatlas/models/library_media.dart';
import 'package:medyaatlas/repositories/media_repository.dart';
import 'package:medyaatlas/services/web_media_session.dart';
import 'package:web/web.dart' as web;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'resolvePlayableUrl ignores a stale blob: URL from a previous session',
    () async {
      Hive.init('medyaatlas_web_test');
      final repo = MediaRepository.instance;
      await repo.init();
      addTearDown(() async {
        for (final item in List.of(repo.items)) {
          await repo.remove(item.id);
        }
      });

      const name = 'stale_photo.jpg';
      const size = 12345;

      // "Önceki oturumdan" kalma bir kayıt: localPath hâlâ blob: şeklinde
      // ama bu süreçte (webSessionRegister hiç çağrılmadı) o File yok —
      // tıpkı sayfa kapanıp yeniden açıldığında olduğu gibi.
      final media = await repo.add(
        name: name,
        kind: MediaKind.photo,
        sourceId: 'gallery',
        relativePath: name,
        sizeBytes: size,
        lat: 41.0,
        lng: 29.0,
        persist: false,
        notify: false,
      );
      await repo.updateLocalPath(
        id: media.id,
        localPath: 'blob:https://example.com/dead-from-last-session',
        persist: false,
      );

      final stale = await repo.resolvePlayableUrl(media);
      expect(
        stale,
        isNull,
        reason:
            'a blob: URL from before this session must never be trusted '
            'as playable — the File behind it is gone',
      );

      // Şimdi dosya "bu oturumda" gerçekten mevcut olsun.
      final bytes = Uint8List.fromList(List<int>.filled(size, 1));
      final file = web.File(
        <JSAny>[bytes.toJS].toJS,
        name,
        web.FilePropertyBag(type: 'image/jpeg'),
      );
      webSessionRegister(name, size, file);

      final fresh = await repo.resolvePlayableUrl(media);
      expect(fresh, isNotNull);
      expect(fresh, startsWith('blob:'));
      expect(
        fresh,
        isNot('blob:https://example.com/dead-from-last-session'),
        reason: 'must be a freshly created blob URL, not the stale one',
      );
    },
  );
}
