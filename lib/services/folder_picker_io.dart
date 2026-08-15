import 'dart:collection';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:path/path.dart' as p;

import 'folder_types.dart';
import 'scan_paths.dart';
import 'volume_mount.dart';

export 'folder_types.dart';

/// SD / büyük klasör: tek [stat], ilerleme, UI’ye nefes aldırma.
Future<FolderPickResult> scanMediaDirectory(
  String dirPath, {
  String? folderName,
  void Function(int found, String currentPath)? onProgress,
}) async {
  final items = <FolderMediaRef>[];
  final normalized = normalizeRootPath(dirPath);
  final queue = Queue<Directory>()..add(Directory(dirPath));
  var found = 0;
  var seen = 0;

  while (queue.isNotEmpty) {
    final dir = queue.removeFirst();
    if (shouldSkipScanDirectory(dir.path)) {
      continue;
    }

    // recursive:true kullanma — Android/data PathAccessException tüm stream’i kırar.
    final List<FileSystemEntity> children;
    try {
      children = await dir.list(followLinks: false).toList();
    } on PathAccessException {
      continue;
    } on FileSystemException {
      continue;
    } catch (_) {
      continue;
    }

    for (final entity in children) {
      seen++;
      if (seen % 80 == 0) {
        await Future<void>.delayed(Duration.zero);
      }
      try {
        if (entity is Directory) {
          if (!shouldSkipScanDirectory(entity.path)) {
            queue.add(entity);
          }
          continue;
        }
        if (entity is! File) continue;
        final name = p.basename(entity.path);
        if (!isMediaName(name)) continue;

        final st = await entity.stat();
        final size = st.size;
        final captured = entity;
        final relative =
            p.relative(entity.path, from: dirPath).replaceAll(r'\', '/');
        items.add(
          FolderMediaRef(
            name: name,
            size: size,
            relativePath: relative,
            localPath: captured.path,
            lastModified: st.modified,
            readHead: (maxBytes) => _readHead(captured, size, maxBytes),
          ),
        );
        found++;
        if (found % 25 == 0) {
          onProgress?.call(found, entity.path);
          await Future<void>.delayed(Duration.zero);
        }
      } on PathAccessException {
        // Tek dosya/klasör — devam.
      } on FileSystemException {
        // Tek dosya/klasör — devam.
      } catch (_) {}
    }
  }

  onProgress?.call(found, dirPath);

  if (items.length <= 5000) {
    items.sort((a, b) {
      final left = (a.relativePath ?? a.name).toLowerCase();
      final right = (b.relativePath ?? b.name).toLowerCase();
      return left.compareTo(right);
    });
  }

  return FolderPickResult(
    folderName: folderName ?? displayNameForRoot(dirPath),
    rootPath: normalized,
    items: items,
  );
}

Future<FolderPickResult?> pickMediaFolder({
  void Function(int found, String currentPath)? onProgress,
}) async {
  final dirPath = await FilePicker.platform.getDirectoryPath(
    dialogTitle: 'Medya klasörü seç (foto + video)',
  );
  if (dirPath == null) return null;
  return scanMediaDirectory(dirPath, onProgress: onProgress);
}

/// SD kart / harici HDD / USB sürücü kökünü seçip tamamını tara.
Future<FolderPickResult?> pickExternalVolume({
  void Function(int found, String currentPath)? onProgress,
}) async {
  final dirPath = await FilePicker.platform.getDirectoryPath(
    dialogTitle: 'SD kart veya harici disk kökünü seç (DCIM / tüm kart)',
  );
  if (dirPath == null) return null;
  final name = displayNameForRoot(dirPath);
  return scanMediaDirectory(
    dirPath,
    folderName: 'Disk · $name',
    onProgress: onProgress,
  );
}

Future<Uint8List> _readHead(File file, int size, int maxBytes) async {
  final n = math.min(size, maxBytes);
  if (n <= 0) return Uint8List(0);
  final raf = await file.open();
  try {
    return await raf.read(n);
  } finally {
    await raf.close();
  }
}
