import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;

import 'android_media_scan.dart';
import 'folder_types.dart';

/// MP4 başlığındaki gömülü JPEG kapak / önizleme (covr vb.).
Uint8List? largestJpegIn(Uint8List data, {int minBytes = 2048}) {
  if (data.length < minBytes + 4) return null;
  Uint8List? best;
  var i = 0;
  final end = data.length - 1;
  while (i < end - 2) {
    if (data[i] == 0xFF && data[i + 1] == 0xD8 && data[i + 2] == 0xFF) {
      var j = i + 3;
      while (j < end) {
        if (data[j] == 0xFF && data[j + 1] == 0xD9) {
          final len = j + 2 - i;
          if (len >= minBytes &&
              len <= previewStoreBytes &&
              (best == null || len > best.length)) {
            best = Uint8List.fromList(data.sublist(i, j + 2));
          }
          i = j + 2;
          break;
        }
        j++;
      }
      if (j >= end) break;
    } else {
      i++;
    }
  }
  return best;
}

bool looksLikeJpeg(Uint8List bytes) =>
    bytes.length >= 4 &&
    bytes[0] == 0xFF &&
    bytes[1] == 0xD8 &&
    bytes[2] == 0xFF;

/// GoPro .THM / yan JPEG (DJI vb.) — tarama sırasında ilk kare yerine.
Future<Uint8List?> siblingPreviewBytes(String? videoPath) async {
  if (videoPath == null || videoPath.isEmpty) return null;
  final dir = p.dirname(videoPath);
  final base = p.basenameWithoutExtension(videoPath);
  const exts = [
    '.THM',
    '.thm',
    '.JPG',
    '.jpg',
    '.JPEG',
    '.jpeg',
    '.PNG',
    '.png',
    '.WEBP',
    '.webp',
  ];
  for (final ext in exts) {
    final file = File(p.join(dir, '$base$ext'));
    if (!await file.exists()) continue;
    try {
      final size = await file.length();
      if (size < 256 || size > previewStoreBytes) continue;
      final bytes = await file.readAsBytes();
      if (looksLikeJpeg(bytes)) return bytes;
      if (bytes.length >= 8 &&
          bytes[0] == 0x89 &&
          bytes[1] == 0x50) {
        return bytes;
      }
    } catch (_) {}
  }
  // DJI: bazen DJI_xxxx_THUM.JPG / .SCR.jpg
  for (final suffix in ['_THUM.JPG', '_THUM.jpg', '.SCR.jpg', '.scr.jpg']) {
    final file = File(p.join(dir, '$base$suffix'));
    if (!await file.exists()) continue;
    try {
      final size = await file.length();
      if (size < 256 || size > previewStoreBytes) continue;
      return await file.readAsBytes();
    } catch (_) {}
  }
  return null;
}

/// Önizleme: MediaStore ilk kare → kardeş JPEG → gömülü JPEG.
/// (Dosya ilk karesi ızgarada VideoThumb ile gösterilir — video_thumbnail yok.)
Future<Uint8List?> extractVideoPreviewBytes({
  required String? localPath,
  String? relativePath,
  Uint8List? head,
}) async {
  final phoneId = phoneAssetIdFromRelativePath(relativePath);
  if (phoneId != null) {
    final phoneThumb = await phoneAssetThumbnailBytes(phoneId);
    if (phoneThumb != null && phoneThumb.isNotEmpty) return phoneThumb;
  }

  final sibling = await siblingPreviewBytes(localPath);
  if (sibling != null && sibling.isNotEmpty) return sibling;

  if (head != null && head.isNotEmpty) {
    final embedded = largestJpegIn(head);
    if (embedded != null && looksLikeJpeg(embedded)) return embedded;
  }

  if (localPath == null || localPath.isEmpty) return null;
  try {
    final file = File(localPath);
    if (!await file.exists()) return null;
    final raf = await file.open();
    try {
      final n = math.min(videoHeadBytes, await file.length());
      final more = await raf.read(n);
      final embedded = largestJpegIn(more);
      if (embedded != null && looksLikeJpeg(embedded)) return embedded;
    } finally {
      await raf.close();
    }
  } catch (_) {}
  return null;
}
