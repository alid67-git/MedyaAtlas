import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';

import 'track_file_types.dart';

export 'track_file_types.dart';

/// Native: mümkünse uzantı filtresi (sistem Galeri’yi öne çıkarmaz).
/// gpx MIME yoksa FileType.any’ye düşülür — yine de içerik doğrulanır.
Future<TrackPickResult?> pickTrackFiles() async {
  FilePickerResult? picked;
  var customOk = false;
  try {
    picked = await FilePicker.platform.pickFiles(
      allowMultiple: true,
      type: FileType.custom,
      allowedExtensions: const ['gpx', 'kml', 'kmz', 'xml'],
      withData: false,
    );
    customOk = true; // iptal de olsa ikinci seçici açma
  } catch (_) {
    customOk = false;
  }
  if (!customOk) {
    picked = await FilePicker.platform.pickFiles(
      allowMultiple: true,
      type: FileType.any,
      withData: false,
    );
  }
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
    if (!isAcceptableTrackFile(name: file.name, bytes: bytes)) {
      wrongType++;
      if (looksLikeImageOrVideoName(file.name) || looksLikeImageBytes(bytes)) {
        sawMedia = true;
      }
      continue;
    }
    out.add(PickedTrackFile(name: file.name, bytes: bytes));
  }

  return TrackPickResult(
    files: out,
    skippedWrongType: wrongType,
    skippedUnreadable: unreadable,
    skippedTooLarge: tooLarge,
    skippedSawMedia: sawMedia,
  );
}
