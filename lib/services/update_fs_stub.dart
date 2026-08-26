Object updateFile(String path) => path;

Future<void> deleteUpdatePath(String path) async {}

Future<String?> downloadUrlToPath(
  String url,
  String path, {
  void Function(double progress)? onProgress,
  required int minBytes,
  int knownTotalBytes = 0,
}) async =>
    'Web’de uygulama içi güncelleme yok.';

Future<String?> unzipWindowsUpdate(String zipPath, String extractPath) async =>
    'Web’de zip açma yok.';
