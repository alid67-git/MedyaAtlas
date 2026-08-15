import 'dart:io';

import 'package:path/path.dart' as p;

/// Karşılaştırma / kimlik için kök yolu.
String normalizeRootPath(String path) {
  var n = p.normalize(path.trim());
  if (Platform.isWindows) {
    n = n.replaceAll('/', r'\');
    // `D:` → `D:\`
    if (RegExp(r'^[a-zA-Z]:$').hasMatch(n)) {
      n = '$n\\';
    }
    n = n.toLowerCase();
  }
  // Kök değilse sondaki ayırıcıyı kırp.
  if (n.length > 1 && (n.endsWith(r'\') || n.endsWith('/'))) {
    final root = p.rootPrefix(n);
    if (n != root && n != '$root/' && n != '$root\\') {
      n = n.substring(0, n.length - 1);
    }
  }
  return n;
}

String displayNameForRoot(String path) {
  final n = p.normalize(path.trim());
  final base = p.basename(n);
  if (base.isNotEmpty) return base;
  final root = p.rootPrefix(n);
  if (root.isNotEmpty) {
    final letter = root.replaceAll(RegExp(r'[:\\/]+'), '');
    if (letter.isNotEmpty) return letter.toUpperCase();
  }
  return n;
}

bool rootPathExists(String path) {
  try {
    return Directory(path).existsSync();
  } catch (_) {
    return false;
  }
}
