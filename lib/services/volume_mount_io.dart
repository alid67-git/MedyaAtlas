import 'dart:io';

import 'package:path/path.dart' as p;

/// Karşılaştırma / kimlik için kök yolu.
String normalizeRootPath(String path) {
  var n = path.trim().replaceAll('/', r'\');
  // Windows sürücü harfi (CI Linux’ta da aynı mantık).
  final driveOnly = RegExp(r'^([a-zA-Z]):\\?$').firstMatch(n);
  if (driveOnly != null) {
    final letter = driveOnly.group(1)!.toLowerCase();
    return Platform.isWindows ? '$letter:\\' : '$letter:';
  }
  if (Platform.isWindows) {
    n = p.windows.normalize(path.trim());
    n = n.toLowerCase();
    if (n.length > 3 && n.endsWith(r'\')) {
      n = n.substring(0, n.length - 1);
    }
    return n;
  }
  n = p.normalize(path.trim());
  if (n.length > 1 && n.endsWith('/')) {
    n = n.substring(0, n.length - 1);
  }
  return n;
}

String displayNameForRoot(String path) {
  final trimmed = path.trim();
  // `D:\GoPro` / `D:/GoPro` — platformdan bağımsız.
  final win = trimmed.replaceAll('/', r'\');
  final driveFolder = RegExp(r'^[a-zA-Z]:\\+(.+)$').firstMatch(win);
  if (driveFolder != null) {
    final rest = driveFolder.group(1)!;
    final parts = rest.split(r'\').where((e) => e.isNotEmpty).toList();
    if (parts.isNotEmpty) return parts.last;
  }
  final driveRoot = RegExp(r'^([a-zA-Z]):\\?$').firstMatch(win);
  if (driveRoot != null) {
    return driveRoot.group(1)!.toUpperCase();
  }
  final base = p.basename(p.normalize(trimmed));
  if (base.isNotEmpty) return base;
  return trimmed;
}

bool rootPathExists(String path) {
  try {
    return Directory(path).existsSync();
  } catch (_) {
    return false;
  }
}
