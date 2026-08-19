/// Dosya adından kabaca MIME (web blob / video_player için).
String mimeFromName(String name) {
  final lower = name.toLowerCase();
  final dot = lower.lastIndexOf('.');
  final ext = dot >= 0 ? lower.substring(dot + 1) : '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
    case 'jpe':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    case 'mkv':
      return 'video/x-matroska';
    default:
      return 'application/octet-stream';
  }
}

/// Web’de Image.network / VideoPlayer.networkUrl ile açılabilir mi?
bool isWebPlayableUrl(String? path) {
  if (path == null || path.isEmpty) return false;
  return path.startsWith('blob:') ||
      path.startsWith('http://') ||
      path.startsWith('https://') ||
      path.startsWith('data:');
}
