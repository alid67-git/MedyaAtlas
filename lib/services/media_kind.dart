import '../models/library_media.dart';

const photoExt = {
  'jpg', 'jpeg', 'jpe', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff',
  'dng', 'gpr', 'arw', 'cr2', 'cr3', 'nef', 'nrw', 'orf', 'raf', 'rw2',
  'pef', 'srw', 'x3f', 'avif', 'gif', 'bmp', 'insp',
};

const videoExt = {
  'mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '360', 'insv',
  'ts', 'mts', 'm2ts', '3gp', '3g2', 'wmv', 'mpg', 'mpeg', 'mpe', 'mp2',
  'flv', 'f4v', 'asf', 'vob', 'divx', 'qt', 'ogv', 'rm', 'rmvb',
};

final _goproName = RegExp(
  r'^(gopr|gpfr|g[xhslaf]\d{6}|gp\d{6}|go\d{6}|gopro)',
  caseSensitive: false,
);
final _djiVideoName = RegExp(
  r'^(DJI[_-]|Osmo[_-]?|DJI)',
  caseSensitive: false,
);

/// MedyaAtlas gibi dosya kopyalanmaz; üst sınır yok.

String extensionOf(String name) {
  final i = name.lastIndexOf('.');
  return i >= 0 ? name.substring(i + 1).toLowerCase() : '';
}

bool isVideoName(String name) => videoExt.contains(extensionOf(name));

bool isPhotoName(String name) => photoExt.contains(extensionOf(name));

bool isMediaName(String name) {
  final ext = extensionOf(name);
  if (ext == 'lrv') return false;
  return photoExt.contains(ext) || videoExt.contains(ext);
}

/// Dosya seçici / rapor için birleşik uzantı listesi.
List<String> get allMediaExtensions => [...photoExt, ...videoExt]..sort();

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

String kindCountsLabel(Map<MediaKind, int> counts) {
  final parts = <String>[];
  void add(MediaKind kind, String label) {
    final n = counts[kind] ?? 0;
    if (n > 0) parts.add('$n $label');
  }

  add(MediaKind.photo, 'foto');
  add(MediaKind.video, 'video');
  add(MediaKind.gopro, 'GoPro');
  add(MediaKind.drone, 'drone');
  return parts.isEmpty ? 'medya yok' : parts.join(' · ');
}
