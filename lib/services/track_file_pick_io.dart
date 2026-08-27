import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';

import 'file_picker_safe.dart';
import 'track_file_types.dart';
import 'track_parse.dart';

export 'track_file_types.dart';

/// Native: çoklu seçim + içerik tanıma. `already_active` güvenli yeniden dener.
Future<TrackPickResult?> pickTrackFiles({bool allowAny = true}) async {
  final picked = await pickFilesResilient(
    allowMultiple: true,
    type: allowAny ? FileType.any : FileType.custom,
    allowedExtensions: allowAny ? null : const ['gpx', 'kml', 'kmz', 'xml'],
    withData: false,
  );
  if (picked == null || picked.files.isEmpty) return null;

  final out = <PickedTrackFile>[];
  var wrongType = 0;
  var unreadable = 0;
  var tooLarge = 0;
  var sawMedia = false;

  for (final file in picked.files) {
    Uint8List? bytes = file.bytes;
    final path = file.path;
    final size = file.size;
    if (size > trackFileMaxBytes) {
      tooLarge++;
      continue;
    }
    if ((bytes == null || bytes.isEmpty) && path != null && path.isNotEmpty) {
      try {
        final len = await File(path).length();
        if (len > trackFileMaxBytes) {
          tooLarge++;
          continue;
        }
        bytes = await File(path).readAsBytes();
      } catch (_) {
        unreadable++;
        continue;
      }
    }
    if (bytes == null || bytes.isEmpty) {
      unreadable++;
      continue;
    }
    final kind = detectTrackFormat(fileName: file.name, bytes: bytes);
    if (kind == null) {
      wrongType++;
      if (looksLikeImageOrVideoName(file.name) || looksLikeImageBytes(bytes)) {
        sawMedia = true;
      }
      continue;
    }
    out.add(
      PickedTrackFile(
        name: ensureTrackExtension(file.name, kind),
        bytes: bytes,
      ),
    );
  }

  return TrackPickResult(
    files: out,
    skippedWrongType: wrongType,
    skippedUnreadable: unreadable,
    skippedTooLarge: tooLarge,
    skippedSawMedia: sawMedia,
  );
}
