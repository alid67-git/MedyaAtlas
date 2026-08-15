import 'dart:io';

import 'package:video_player/video_player.dart';

Future<VideoPlayerController?> openVideoFileController(String path) async {
  final file = File(path);
  if (!await file.exists()) return null;
  return VideoPlayerController.file(file);
}

Future<bool> videoFileExists(String path) async {
  try {
    return await File(path).exists();
  } catch (_) {
    return false;
  }
}
