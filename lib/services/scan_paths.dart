import 'package:path/path.dart' as p;

String _normScanPath(String path) =>
    path.replaceAll('\\', '/').replaceAll(RegExp(r'/+'), '/');

/// Android / Windows’ta tarama dışı klasörler (izin yok veya medya yok).
bool shouldSkipScanDirectory(String path) {
  final normalized = _normScanPath(path);
  final parts = normalized.split('/').where((e) => e.isNotEmpty).map((e) => e.toLowerCase()).toList();
  for (final part in parts) {
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
        part == 'found.000' ||
        part == '\$windows.~bt' ||
        part == 'windows' ||
        part == 'program files' ||
        part == 'program files (x86)' ||
        part == 'programdata' ||
        part == 'node_modules' ||
        part == '.git' ||
        part == '.cache' ||
        part == 'appdata') {
      return true;
    }
  }
  final base = p.basename(normalized).toLowerCase();
  return base.startsWith('.trash') ||
      (base.startsWith('.') && base != '.' && base != '..');
}

/// Büyük diskte önce medya köklerine bak (DCIM, GoPro, DJI…).
int mediaScanPriority(String path) {
  final base = p.basename(_normScanPath(path)).toLowerCase();
  const first = {
    'dcim',
    'gopro',
    'camera',
    '100gopro',
    'movies',
    'pictures',
    'photo',
    'photos',
    'video',
    'videos',
    'media',
    'mp_root',
  };
  if (first.contains(base)) return 0;
  if (base.startsWith('dji') ||
      base.startsWith('osmo') ||
      base.startsWith('100') ||
      base.startsWith('gopro') ||
      base.contains('gopro')) {
    return 0;
  }
  if (base == 'download' || base == 'downloads' || base == 'documents') {
    return 1;
  }
  return 2;
}
