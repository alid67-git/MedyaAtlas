import 'folder_types.dart';

export 'folder_types.dart';

Future<FolderPickResult?> pickMediaFolder({
  void Function(int found, String currentPath)? onProgress,
  bool Function()? isCancelled,
}) async {
  throw UnsupportedError('Klasör seçimi bu platformda yok.');
}

Future<FolderPickResult?> pickExternalVolume({
  void Function(int found, String currentPath)? onProgress,
  bool Function()? isCancelled,
}) async {
  throw UnsupportedError('Disk seçimi bu platformda yok.');
}

Future<FolderPickResult> scanMediaDirectory(
  String dirPath, {
  String? folderName,
  void Function(int found, String currentPath)? onProgress,
  bool Function()? isCancelled,
}) async {
  throw UnsupportedError('Klasör tarama bu platformda yok.');
}

Future<FolderPickResult?> pickMultipleMediaFiles() async {
  throw UnsupportedError('Çoklu medya seçimi bu platformda yok.');
}
