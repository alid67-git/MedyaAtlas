import 'dart:typed_data';

bool localPathExistsSync(String path) => false;

bool localIsDirectorySync(String path) => false;

bool localIsFileSync(String path) => false;

Future<bool> localFileExists(String path) async => false;

Future<int> localFileLength(String path) async => 0;

Future<DateTime?> localFileModified(String path) async => null;

Future<Uint8List> readLocalFileHead(String path, int maxBytes) async =>
    Uint8List(0);

Future<Uint8List?> readLocalTextFileLimited(
  String path, {
  int maxBytes = 8 * 1024 * 1024,
}) async =>
    null;

/// Web’de dosya yolu yok.
Never localFile(String path) =>
    throw UnsupportedError('Yerel dosya web’de yok: $path');
