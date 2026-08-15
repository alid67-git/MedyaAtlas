import 'dart:typed_data';

import 'folder_types.dart';

Future<String?> installApkFile(String path) async => 'Web’de APK kurulumu yok.';

/// Web’de APK yolu yok; yalnızca tip uyumu için.
class ApkDownloadDir {
  const ApkDownloadDir(this.path);
  final String path;
}

Future<ApkDownloadDir> apkDownloadDirectory() async =>
    const ApkDownloadDir('');

bool looksLikeApk(Object file) => false;

String? phoneAssetIdFromRelativePath(String? relativePath) {
  if (relativePath == null) return null;
  final parts = relativePath.split('/');
  if (parts.length >= 2 && parts[0] == 'phone' && parts[1].isNotEmpty) {
    return parts[1];
  }
  return null;
}

Future<FolderPickResult> scanEntirePhoneMedia({
  int maxAssets = 8000,
  void Function(String status)? onProgress,
}) async {
  throw UnsupportedError('Telefon tarama web’de yok; dosya seçici kullanın.');
}

Future<({double? lat, double? lng, Uint8List? head})> readPhoneAssetGps({
  required String assetId,
  required bool isPhoto,
  required int headLimit,
}) async =>
    (lat: null, lng: null, head: null);

Future<Uint8List?> phoneAssetThumbnailBytes(
  String assetId, {
  int size = 360,
}) async =>
    null;
