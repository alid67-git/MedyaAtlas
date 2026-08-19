import 'dart:math' as math;
import 'dart:typed_data';

import 'package:path/path.dart' as p;

import 'android_media_scan.dart';
import 'folder_types.dart';
import 'local_fs.dart';

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

/// HEIC/HEIF — Flutter web Image.memory çoğu zaman çözemez; blob Image.network kullan.
bool looksLikeHeic(Uint8List bytes) {
  if (bytes.length < 12) return false;
  // ....ftyp....
  return bytes[4] == 0x66 &&
      bytes[5] == 0x74 &&
      bytes[6] == 0x79 &&
      bytes[7] == 0x70;
}

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
    final path = p.join(dir, '$base$ext');
    if (!await localFileExists(path)) continue;
    try {
      final size = await localFileLength(path);
      if (size < 256 || size > previewStoreBytes) continue;
      final bytes = await readLocalFileHead(path, size);
      if (looksLikeJpeg(bytes)) return bytes;
      if (bytes.length >= 8 && bytes[0] == 0x89 && bytes[1] == 0x50) {
        return bytes;
      }
    } catch (_) {}
  }
  // DJI: bazen DJI_xxxx_THUM.JPG / .SCR.jpg
  for (final suffix in ['_THUM.JPG', '_THUM.jpg', '.SCR.jpg', '.scr.jpg']) {
    final path = p.join(dir, '$base$suffix');
    if (!await localFileExists(path)) continue;
    try {
      final size = await localFileLength(path);
      if (size < 256 || size > previewStoreBytes) continue;
      return await readLocalFileHead(path, size);
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
    if (!await localFileExists(localPath)) return null;
    final n = math.min(videoHeadBytes, await localFileLength(localPath));
    final more = await readLocalFileHead(localPath, n);
    final embedded = largestJpegIn(more);
    if (embedded != null && looksLikeJpeg(embedded)) return embedded;
  } catch (_) {}
  return null;
}
