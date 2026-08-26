import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';

import 'track_file_types.dart';

export 'track_file_types.dart';

/// Native: filtre yok → uzantı + içerik sniffer; büyük dosyalar diskten okunur.
Future<TrackPickResult?> pickTrackFiles() async {
  final picked = await FilePicker.platform.pickFiles(
    allowMultiple: true,
    type: FileType.any,
    withData: false,
  );
  if (picked == null || picked.files.isEmpty) return null;

  final out = <PickedTrackFile>[];
  var wrongType = 0;
  var unreadable = 0;
  var tooLarge = 0;

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
      continue;
    }
    out.add(PickedTrackFile(name: file.name, bytes: bytes));
  }

  return TrackPickResult(
    files: out,
    skippedWrongType: wrongType,
    skippedUnreadable: unreadable,
    skippedTooLarge: tooLarge,
  );
}
