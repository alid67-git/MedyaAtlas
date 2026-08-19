import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:medyaatlas/models/library_media.dart';
import 'package:medyaatlas/repositories/media_repository.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('persisted index survives many adds + a targeted update', () async {
    final dir = await Directory.systemTemp.createTemp('medyaatlas_hive_test');
    Hive.init(dir.path);
    addTearDown(() async {
      await Hive.deleteFromDisk();
      await dir.delete(recursive: true);
    });

    final repo = MediaRepository.instance;
    await repo.init();

    // Binlerce medyalı gerçek kütüphaneyi taklit et.
    const total = 500;
    for (var i = 0; i < total; i++) {
      await repo.add(
        name: 'photo_$i.jpg',
        kind: MediaKind.photo,
        sourceId: 'gallery',
        relativePath: 'photo_$i.jpg',
        sizeBytes: 1000 + i,
        lat: 41.0 + i * 0.0001,
        lng: 29.0 + i * 0.0001,
        persist: false,
        notify: false,
      );
    }
    await repo.flush(notify: false);

    // Ham kaydı oku, tüm öğelerin doğru şekilde yazıldığını doğrula.
    final box = await Hive.openBox<String>('medyaatlas_media');
    final raw1 = box.get('index');
    expect(raw1, isNotNull);
    final decoded1 = jsonDecode(raw1!) as List;
    expect(decoded1.length, total);

    final items1 = decoded1
        .map((e) => LibraryMedia.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
    for (var i = 0; i < total; i++) {
      final m = items1.firstWhere((x) => x.name == 'photo_$i.jpg');
      expect(m.lat, closeTo(41.0 + i * 0.0001, 1e-9));
      expect(m.sizeBytes, 1000 + i);
    }

    // Tek bir öğeyi güncelle (yeniden dene senaryosu) — önbellek geçersiz
    // kılınmalı, diğer 499 öğe önbellekten aynen tekrar kullanılmalı ama
    // sonuçta yazılan JSON yine tam ve doğru olmalı.
    final target = items1.firstWhere((x) => x.name == 'photo_42.jpg');
    await repo.updateLocation(
      id: target.id,
      lat: 50.5,
      lng: 10.5,
      persist: false,
      notify: false,
    );
    await repo.flush(notify: false);

    final raw2 = box.get('index');
    final decoded2 = jsonDecode(raw2!) as List;
    expect(decoded2.length, total, reason: 'update should not drop items');

    final items2 = decoded2
        .map((e) => LibraryMedia.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();

    final updated = items2.firstWhere((x) => x.name == 'photo_42.jpg');
    expect(updated.lat, closeTo(50.5, 1e-9));
    expect(updated.lng, closeTo(10.5, 1e-9));

    // Değişmeyen bir öğe hâlâ eski (doğru) değerinde olmalı — önbellekten
    // gelen JSON bozulmamış.
    final untouched = items2.firstWhere((x) => x.name == 'photo_7.jpg');
    expect(untouched.lat, closeTo(41.0 + 7 * 0.0001, 1e-9));

    // NaN/Infinity kaydı da hâlâ jsonEncode'i düşürmeden temizlenmeli.
    await repo.updateLocation(
      id: target.id,
      lat: double.nan,
      lng: double.infinity,
      persist: false,
      notify: false,
    );
    await repo.flush(notify: false);
    final raw3 = box.get('index');
    expect(raw3, isNotNull);
    final decoded3 = jsonDecode(raw3!) as List;
    final scrubbed = decoded3
        .map((e) => LibraryMedia.fromJson(Map<String, dynamic>.from(e as Map)))
        .firstWhere((x) => x.name == 'photo_42.jpg');
    expect(scrubbed.hasLocation, isFalse);
  });
}
