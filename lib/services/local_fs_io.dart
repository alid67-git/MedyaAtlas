import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

bool localPathExistsSync(String path) {
  try {
    return FileSystemEntity.typeSync(path) != FileSystemEntityType.notFound;
  } catch (_) {
    return false;
  }
}

bool localIsDirectorySync(String path) {
  try {
    return FileSystemEntity.isDirectorySync(path);
  } catch (_) {
    return false;
  }
}

bool localIsFileSync(String path) {
  try {
    return FileSystemEntity.isFileSync(path);
  } catch (_) {
    return false;
  }
}

Future<bool> localFileExists(String path) async {
  try {
    return await File(path).exists();
  } catch (_) {
    return false;
  }
}

Future<int> localFileLength(String path) async {
  try {
    return await File(path).length();
  } catch (_) {
    return 0;
  }
}

Future<DateTime?> localFileModified(String path) async {
  try {
    return await File(path).lastModified();
  } catch (_) {
    return null;
  }
}

Future<Uint8List> readLocalFileHead(String path, int maxBytes) async {
  final file = File(path);
  final size = await file.length();
  final n = math.min(size, maxBytes);
  if (n <= 0) return Uint8List(0);
  final raf = await file.open();
  try {
    return await raf.read(n);
  } finally {
    await raf.close();
  }
}

Future<Uint8List?> readLocalTextFileLimited(
  String path, {
  int maxBytes = 8 * 1024 * 1024,
}) async {
  final file = File(path);
  if (!await file.exists()) return null;
  final len = await file.length();
  if (len <= 0 || len > maxBytes) return null;
  return file.readAsBytes();
}

File localFile(String path) => File(path);
