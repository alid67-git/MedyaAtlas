import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:path/path.dart' as p;

import 'folder_types.dart';

export 'folder_types.dart';

Future<FolderPickResult> scanMediaDirectory(String dirPath) async {
  final items = <FolderMediaRef>[];
  final root = Directory(dirPath);

  await for (final entity in root.list(recursive: true, followLinks: false)) {
    if (entity is! File) continue;
    final name = p.basename(entity.path);
    if (!isMediaName(name)) continue;
    final size = await entity.length();
    final captured = entity;
    final relative = p.relative(entity.path, from: dirPath).replaceAll(r'\', '/');
    items.add(
      FolderMediaRef(
        name: name,
        size: size,
        relativePath: relative,
        localPath: captured.path,
        lastModified: await captured.lastModified(),
        readHead: (maxBytes) => _readHead(captured, size, maxBytes),
      ),
    );
  }

  return FolderPickResult(
    folderName: p.basename(dirPath),
    items: items,
  );
}

Future<FolderPickResult?> pickMediaFolder() async {
  final dirPath = await FilePicker.platform.getDirectoryPath(
    dialogTitle: 'Medya klasörü seç',
  );
  if (dirPath == null) return null;
  return scanMediaDirectory(dirPath);
}

Future<Uint8List> _readHead(File file, int size, int maxBytes) async {
  final n = math.min(size, maxBytes);
  final raf = await file.open();
  try {
    return await raf.read(n);
  } finally {
    await raf.close();
  }
}
