import 'dart:io';

import 'package:video_player/video_player.dart';

Future<VideoPlayerController?> openVideoFileController(String path) async {
  if (path.startsWith('content://')) {
    if (!Platform.isAndroid) return null;
    try {
      return VideoPlayerController.contentUri(Uri.parse(path));
    } catch (_) {
      return null;
    }
  }
  final file = File(path);
  if (!await file.exists()) return null;
  return VideoPlayerController.file(file);
}

Future<bool> videoFileExists(String path) async {
  try {
    if (path.startsWith('content://')) return Platform.isAndroid;
    return await File(path).exists();
  } catch (_) {
    return false;
  }
}

/// Önce content URI / verilen yol; olmazsa [fallbackPath] (ör. file path).
/// Başarılı dönüşte controller zaten [initialize] edilmiş olur.
Future<VideoPlayerController?> openVideoControllerWithFallback({
  required String? primary,
  String? fallbackPath,
}) async {
  Future<VideoPlayerController?> tryOpen(String? p) async {
    if (p == null || p.isEmpty) return null;
    final c = await openVideoFileController(p);
    if (c == null) return null;
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
  if (fallbackPath != null &&
      fallbackPath.isNotEmpty &&
      fallbackPath != primary) {
    return tryOpen(fallbackPath);
  }
  return null;
}
