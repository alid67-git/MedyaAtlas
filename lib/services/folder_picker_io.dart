import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:path/path.dart' as p;

import 'folder_types.dart';
import 'volume_mount.dart';

export 'folder_types.dart';

Future<FolderPickResult> scanMediaDirectory(
  String dirPath, {
  String? folderName,
}) async {
  final items = <FolderMediaRef>[];
  final root = Directory(dirPath);
  final normalized = normalizeRootPath(dirPath);

  // Windows’ta kilitli/izinli olmayan bir dosya tüm taramayı düşürmesin.
  await for (final entity in root.list(
    recursive: true,
    followLinks: false,
  )) {
    try {
      if (entity is! File) continue;
      final name = p.basename(entity.path);
      if (!isMediaName(name)) continue;
      final size = await entity.length();
      final captured = entity;
      final relative =
          p.relative(entity.path, from: dirPath).replaceAll(r'\', '/');
      DateTime? modified;
      try {
        modified = await captured.lastModified();
      } catch (_) {}
      items.add(
        FolderMediaRef(
          name: name,
          size: size,
          relativePath: relative,
          localPath: captured.path,
          lastModified: modified,
          readHead: (maxBytes) => _readHead(captured, size, maxBytes),
        ),
      );
    } catch (_) {
      // Atlana bilir (izin, kilit, bozulmuş yol) — diğer dosyalar devam.
    }
  }

  items.sort((a, b) {
    final left = (a.relativePath ?? a.name).toLowerCase();
    final right = (b.relativePath ?? b.name).toLowerCase();
    return left.compareTo(right);
  });

  return FolderPickResult(
    folderName: folderName ?? displayNameForRoot(dirPath),
    rootPath: normalized,
    items: items,
  );
}

Future<FolderPickResult?> pickMediaFolder() async {
  final dirPath = await FilePicker.platform.getDirectoryPath(
    dialogTitle: 'Medya klasörü seç (foto + video)',
  );
  if (dirPath == null) return null;
  return scanMediaDirectory(dirPath);
}

/// SD kart / harici HDD / USB sürücü kökünü seçip tamamını tara.
Future<FolderPickResult?> pickExternalVolume() async {
  final dirPath = await FilePicker.platform.getDirectoryPath(
    dialogTitle: 'SD kart veya harici disk kökünü seç',
  );
  if (dirPath == null) return null;
  final name = displayNameForRoot(dirPath);
  return scanMediaDirectory(
    dirPath,
    folderName: 'Disk · $name',
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
