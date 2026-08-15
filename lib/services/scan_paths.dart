import 'package:path/path.dart' as p;

/// Android / Windows’ta tarama dışı klasörler (izin yok veya medya yok).
bool shouldSkipScanDirectory(String path) {
  final parts = p.split(path).map((e) => e.toLowerCase()).toList();
  for (var i = 0; i < parts.length; i++) {
    final part = parts[i];
    if (part == 'android') {
      // /…/Android veya /…/Android/data|obb — uygulama özel alanı.
      return true;
    }
    if (part == 'lost+found' ||
        part == '.trash' ||
        part == '.trashes' ||
        part == '\$recycle.bin' ||
        part == 'system volume information' ||
        part == '.android_secure' ||
        part == 'found.000') {
      return true;
    }
  }
  final base = p.basename(path).toLowerCase();
  return base.startsWith('.trash');
}
