import 'package:video_player/video_player.dart';

import '../services/media_mime.dart';

/// Web: blob:/http(s) için network controller; gerçek dosya yolu yok.
Future<VideoPlayerController?> openVideoFileController(String path) async {
  if (!isWebPlayableUrl(path)) return null;
  return VideoPlayerController.networkUrl(Uri.parse(path));
}

Future<bool> videoFileExists(String path) async => isWebPlayableUrl(path);

Future<VideoPlayerController?> openVideoControllerWithFallback({
  required String? primary,
  String? fallbackPath,
}) async {
  Future<VideoPlayerController?> tryOpen(String? p) async {
    if (p == null || p.isEmpty || !isWebPlayableUrl(p)) return null;
    final c = VideoPlayerController.networkUrl(Uri.parse(p));
    try {
      await c.initialize();
      return c;
    } catch (_) {
      await c.dispose();
      return null;
    }
  }

  final first = await tryOpen(primary);
  if (first != null) return first;
  if (fallbackPath != null && fallbackPath != primary) {
    return tryOpen(fallbackPath);
  }
  return null;
}
