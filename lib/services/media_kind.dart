import '../models/library_media.dart';

const photoExt = {
  'jpg', 'jpeg', 'jpe', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff',
  'dng', 'gpr', 'arw', 'cr2', 'cr3', 'nef', 'nrw', 'orf', 'raf', 'rw2',
  'pef', 'srw', 'x3f', 'avif', 'gif', 'bmp', 'insp',
};

const videoExt = {
  'mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '360', 'insv',
  'ts', 'mts', 'm2ts', '3gp', '3g2', 'wmv', 'mpg', 'mpeg',
};

final _goproName = RegExp(
  r'^(gopr|g[xhs]\d{6}|gpfr|gp\d{6}|go\d{6})',
  caseSensitive: false,
);
final _djiVideoName = RegExp(r'^DJI[_-]', caseSensitive: false);

/// MedyaAtlas gibi dosya kopyalanmaz; üst sınır yok.

String extensionOf(String name) {
  final i = name.lastIndexOf('.');
  return i >= 0 ? name.substring(i + 1).toLowerCase() : '';
}

bool isVideoName(String name) => videoExt.contains(extensionOf(name));

bool isMediaName(String name) {
  final ext = extensionOf(name);
  if (ext == 'lrv') return false;
  return photoExt.contains(ext) || videoExt.contains(ext);
}

MediaKind? detectKind(String name) {
  final ext = extensionOf(name);
  if (ext == 'lrv') return null;
  if (photoExt.contains(ext)) return MediaKind.photo;
  if (videoExt.contains(ext)) {
    final stem = name.replaceFirst(RegExp(r'\.[^.]+$'), '');
    if (_djiVideoName.hasMatch(stem)) return MediaKind.drone;
    if (_goproName.hasMatch(stem)) return MediaKind.gopro;
    return MediaKind.video;
  }
  return null;
}

String kindLabel(MediaKind kind, {required bool en}) => switch (kind) {
      MediaKind.photo => en ? 'Photo' : 'Fotoğraf',
      MediaKind.video => 'Video',
      MediaKind.gopro => 'GoPro',
      MediaKind.drone => 'Drone',
    };
