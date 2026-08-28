import 'dart:typed_data';

import 'package:latlong2/latlong.dart';

import 'folder_types.dart';

export '../models/library_media.dart'
    show phoneAssetIdFromRelativePath, phoneRelativePath;

Future<String?> installApkFile(String path) async => 'Web’de APK kurulumu yok.';

/// Web’de APK yolu yok; yalnızca tip uyumu için.
class ApkDownloadDir {
  const ApkDownloadDir(this.path);
  final String path;
}

Future<ApkDownloadDir> apkDownloadDirectory() async =>
    const ApkDownloadDir('');

bool looksLikeApk(Object file) => false;

Future<FolderPickResult> scanEntirePhoneMedia({
  int maxAssets = 8000,
  void Function(String status)? onProgress,
  Set<String>? knownAssetIds,
  Set<String>? needGpsAssetIds,
}) async {
  throw UnsupportedError('Telefon tarama web’de yok; dosya seçici kullanın.');
}

/// İzin zaten verilmiş mi — diyalog göstermeden (açılış taraması).
Future<bool> hasPhoneMediaAccessSilently() async => false;

/// Galeride DJI videoya eşleşen `.SRT` GPS.
Future<LatLng?> readPhoneDjiSidecarGps(String videoFileName) async => null;

Future<FolderPickResult> scanFavoritePhoneMedia({
  int maxAssets = 8000,
  void Function(String status)? onProgress,
}) async {
  throw UnsupportedError(
    'Favorilerin tamamını otomatik almak web’de yok. '
    'Safari’de Galeri’den Favoriler albümünü açıp tek tek / çoklu seçin.',
  );
}

Future<({double? lat, double? lng, Uint8List? head})> readPhoneAssetGps({
  required String assetId,
  required bool isPhoto,
  required int headLimit,
}) async =>
    (lat: null, lng: null, head: null);

Future<
    ({
      double? lat,
      double? lng,
      String? path,
      Uint8List? head,
      Uint8List? tail,
    })> readPhoneAssetGpsDeep({
  required String assetId,
  required bool isPhoto,
  int headLimit = 0,
  int tailLimit = 0,
}) async =>
    (lat: null, lng: null, path: null, head: null, tail: null);

Future<String?> phoneAssetPlayableUri(String assetId) async => null;

Future<Uint8List?> phoneAssetThumbnailBytes(
  String assetId, {
  int size = 360,
}) async =>
    null;
