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

/// Dosya başını oku. [isCancelled] true olursa kısmi/boş döner (iptal).
Future<Uint8List> readLocalFileHead(
  String path,
  int maxBytes, {
  bool Function()? isCancelled,
}) async {
  final file = File(path);
  final size = await file.length();
  final n = math.min(size, maxBytes);
  if (n <= 0) return Uint8List(0);
  if (isCancelled?.call() == true) return Uint8List(0);

  // Küçük head: tek okuma.
  const chunk = 512 * 1024;
  if (n <= chunk || isCancelled == null) {
    final raf = await file.open();
    try {
      if (isCancelled?.call() == true) return Uint8List(0);
      return await raf.read(n);
    } finally {
      await raf.close();
    }
  }

  // Büyük head: dilimli oku — iptal bir sonraki dilimde işler.
  final out = BytesBuilder(copy: false);
  final raf = await file.open();
  try {
    var remaining = n;
    while (remaining > 0) {
      if (isCancelled()) return Uint8List(0);
      final take = remaining > chunk ? chunk : remaining;
      out.add(await raf.read(take));
      remaining -= take;
      await Future<void>.delayed(Duration.zero);
    }
    return out.takeBytes();
  } finally {
    await raf.close();
  }
}

Future<Uint8List?> readLocalTextFileLimited(
  String path, {
  int maxBytes = 8 * 1024 * 1024,
  bool Function()? isCancelled,
}) async {
  final file = File(path);
  if (!await file.exists()) return null;
  final len = await file.length();
  if (len <= 0 || len > maxBytes) return null;
  if (isCancelled?.call() == true) return null;
  final bytes = await readLocalFileHead(path, len, isCancelled: isCancelled);
  if (isCancelled?.call() == true || bytes.isEmpty) return null;
  return bytes;
}

/// Dosya sonundan oku (GoPro `moov` / GPMF çoğu zaman sonda).
Future<Uint8List> readLocalFileTail(
  String path,
  int maxBytes, {
  bool Function()? isCancelled,
}) async {
  final file = File(path);
  final size = await file.length();
  final n = math.min(size, maxBytes);
  if (n <= 0) return Uint8List(0);
  if (isCancelled?.call() == true) return Uint8List(0);

  const chunk = 512 * 1024;
  final raf = await file.open();
  try {
    await raf.setPosition(size - n);
    if (n <= chunk || isCancelled == null) {
      if (isCancelled?.call() == true) return Uint8List(0);
      return await raf.read(n);
    }
    final out = BytesBuilder(copy: false);
    var remaining = n;
    while (remaining > 0) {
      if (isCancelled()) return Uint8List(0);
      final take = remaining > chunk ? chunk : remaining;
      out.add(await raf.read(take));
      remaining -= take;
      await Future<void>.delayed(Duration.zero);
    }
    return out.takeBytes();
  } finally {
    await raf.close();
  }
}

File localFile(String path) => File(path);
