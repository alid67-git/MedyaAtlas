import 'folder_types.dart';

export 'folder_types.dart';

Future<FolderPickResult?> pickMediaFolder() async {
  throw UnsupportedError('Klasör seçimi bu platformda yok.');
}

Future<FolderPickResult> scanMediaDirectory(String dirPath) async {
  throw UnsupportedError('Klasör tarama bu platformda yok.');
}
