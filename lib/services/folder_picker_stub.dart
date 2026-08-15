import 'folder_types.dart';

export 'folder_types.dart';

Future<FolderPickResult?> pickMediaFolder() async {
  throw UnsupportedError('Klasör seçimi bu platformda yok.');
}

Future<FolderPickResult?> pickExternalVolume() async {
  throw UnsupportedError('Disk seçimi bu platformda yok.');
}

Future<FolderPickResult> scanMediaDirectory(
  String dirPath, {
  String? folderName,
}) async {
  throw UnsupportedError('Klasör tarama bu platformda yok.');
}
