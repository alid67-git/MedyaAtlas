import 'dart:typed_data';

import 'media_kind.dart';

export 'media_kind.dart';

const photoHeadBytes = 2 * 1024 * 1024;
const videoHeadBytes = 4 * 1024 * 1024;
const previewStoreBytes = 3 * 1024 * 1024;

/// Web: tam dosyayı Hive’a yazma — blob URL + küçük head (kilitlenme önleme).
const webStorePhotoBytes = 2 * 1024 * 1024;
/// Web’de video payload Hive’a yazılmaz (GoPro 100MB+ telefonu kilitler).
const webStoreVideoBytes = 0;

/// SD / büyük disk taraması — EXIF / ©xyz için yeterli.
const bulkPhotoHeadBytes = 512 * 1024;
const bulkVideoHeadBytes = 1024 * 1024;

/// GoPro GPMF / DJI gömülü GPS — toplu taramada da okunacak kadar head.
const bulkGpsVideoHeadBytes = 8 * 1024 * 1024;

/// Web çoklu seçim: GPMF için daha küçük head (hız).
const webGpsVideoHeadBytes = 4 * 1024 * 1024;

class FolderMediaRef {
  const FolderMediaRef({
    required this.name,
    required this.size,
    required this.readHead,
    this.relativePath,
    this.localPath,
    this.lastModified,
    this.knownLat,
    this.knownLng,
  });

  final String name;
  final int size;
  final String? relativePath;
  final String? localPath;
  final DateTime? lastModified;
  /// Drive imageMediaMetadata vb. — dosya indirilmeden bilinen GPS.
  final double? knownLat;
  final double? knownLng;
  final Future<Uint8List> Function(int maxBytes) readHead;

  bool get isVideo => isVideoName(name);
}

class FolderPickResult {
  const FolderPickResult({
    required this.folderName,
    required this.items,
    this.rootPath,
  });

  final String folderName;
  final List<FolderMediaRef> items;
  /// Harici disk / klasör kökü — çıkınca pinler gizlenir, takılınca geri gelir.
  final String? rootPath;
}
