import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';

import 'host_platform.dart';

/// Android 10+ EXIF GPS için [Permission.accessMediaLocation] şart.
/// Google Fotoğraflar bulutu taranmaz; yerel DCIM / Dosyalar gerekir.
Future<MediaPermissionResult> ensureAndroidMediaAccess() async {
  if (kIsWeb || !hostIsAndroid) {
    return const MediaPermissionResult(ok: true);
  }

  final photos = await Permission.photos.request();
  final videos = await Permission.videos.request();
  final mediaLoc = await Permission.accessMediaLocation.request();

  // Eski Android (≤12): depolama izni.
  PermissionStatus storage = PermissionStatus.granted;
  if (await Permission.storage.isDenied ||
      await Permission.storage.isRestricted) {
    storage = await Permission.storage.request();
  }

  final mediaOk = photos.isGranted ||
      photos.isLimited ||
      videos.isGranted ||
      videos.isLimited ||
      storage.isGranted;
  final locOk = mediaLoc.isGranted || mediaLoc.isLimited;

  if (!mediaOk) {
    return const MediaPermissionResult(
      ok: false,
      message:
          'Medya izni yok. Ayarlar → MedyaAtlas → Fotoğraf/Video iznini aç.',
    );
  }
  if (!locOk) {
    return const MediaPermissionResult(
      ok: false,
      message:
          'Konum (medya) izni yok. Android EXIF GPS için “medya konumu” '
          'izni gerekir. Ayarlar → MedyaAtlas → İzinler.',
    );
  }
  return const MediaPermissionResult(ok: true);
}

class MediaPermissionResult {
  const MediaPermissionResult({required this.ok, this.message});

  final bool ok;
  final String? message;
}
