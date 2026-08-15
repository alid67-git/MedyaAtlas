import 'package:video_player/video_player.dart';

import '../services/media_mime.dart';

/// Web: blob:/http(s) için network controller; gerçek dosya yolu yok.
Future<VideoPlayerController?> openVideoFileController(String path) async {
  if (!isWebPlayableUrl(path)) return null;
  return VideoPlayerController.networkUrl(Uri.parse(path));
}

Future<bool> videoFileExists(String path) async => isWebPlayableUrl(path);
