import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';

import 'local_fs.dart';
import 'track_file_types.dart';
import 'track_parse.dart';

export 'track_file_types.dart';

/// Native: prefer unfiltered picker then keep only track extensions.
/// Custom `.gpx` filters are unreliable on some Android/iOS file UIs.
Future<List<PickedTrackFile>?> pickTrackFiles() async {
  final picked = await FilePicker.platform.pickFiles(
    allowMultiple: true,
    type: FileType.any,
    withData: false,
  );
  if (picked == null || picked.files.isEmpty) return null;

  final out = <PickedTrackFile>[];
  for (final file in picked.files) {
    if (!isTrackFileName(file.name)) continue;
    Uint8List? bytes = file.bytes;
    if ((bytes == null || bytes.isEmpty) && file.path != null) {
      final path = file.path!;
      bytes = await readLocalTextFileLimited(path, maxBytes: 64 * 1024 * 1024);
      if (bytes == null || bytes.isEmpty) {
        try {
          bytes = await File(path).readAsBytes();
        } catch (_) {
          bytes = null;
        }
      }
    }
    if (bytes == null || bytes.isEmpty) continue;
    out.add(PickedTrackFile(name: file.name, bytes: bytes));
  }
  return out;
}
