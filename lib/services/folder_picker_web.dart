import 'dart:async';
import 'dart:js_interop';
import 'dart:math' as math;

import 'package:web/web.dart' as web;

import 'folder_types.dart';

export 'folder_types.dart';

/// iPhone Safari’de klasör seçimi yok — çoklu foto/video seçici.
/// Masaüstü Chrome’da mümkünse klasör (webkitdirectory) dener.
Future<FolderPickResult?> pickMediaFolder({
  void Function(int found, String currentPath)? onProgress,
  bool Function()? isCancelled,
}) async {
  final folder = await _pickWithInput(directory: true);
  if (folder != null && folder.items.isNotEmpty) return folder;
  return _pickWithInput(directory: false);
}

Future<FolderPickResult?> pickExternalVolume({
  void Function(int found, String currentPath)? onProgress,
  bool Function()? isCancelled,
}) async {
  // Web’de harici disk kökü yok; aynı seçici.
  return pickMediaFolder(onProgress: onProgress, isCancelled: isCancelled);
}

Future<FolderPickResult> scanMediaDirectory(
  String dirPath, {
  String? folderName,
  void Function(int found, String currentPath)? onProgress,
  bool Function()? isCancelled,
}) async {
  throw UnsupportedError('Klasör yolu tarama web’de yok; dosya seçici kullanın.');
}

Future<FolderPickResult?> _pickWithInput({required bool directory}) async {
  final input = web.HTMLInputElement()
    ..type = 'file'
    ..multiple = true;
  input.accept = 'image/*,video/*,.jpg,.jpeg,.png,.heic,.heif,.mp4,.mov,.m4v';
  if (directory) {
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }

  final done = Completer<FolderPickResult?>();

  void finish(FolderPickResult? value) {
    if (!done.isCompleted) done.complete(value);
  }

  input.addEventListener(
    'change',
    (web.Event _) {
      final list = input.files;
      if (list == null || list.length == 0) {
        finish(null);
        return;
      }
      finish(_fromFileList(list, directory: directory));
    }.toJS,
  );
  input.addEventListener(
    'cancel',
    (web.Event _) {
      finish(null);
    }.toJS,
  );

  input.click();
  return done.future;
}

FolderPickResult _fromFileList(
  web.FileList list, {
  required bool directory,
}) {
  final items = <FolderMediaRef>[];
  var folderName = directory ? 'klasör' : 'Seçilen medya';

  for (var i = 0; i < list.length; i++) {
    final file = list.item(i);
    if (file == null) continue;
    final relative = file.webkitRelativePath;
    if (relative.isNotEmpty) {
      folderName = relative.split('/').first;
    }
    if (!isMediaName(file.name)) continue;
    final captured = file;
    // Video: oturum boyunca oynatma için blob URL (Hive’a yazılmaz).
    // Foto: baytlar ingest’te saklanır; blob şart değil.
    final blobUrl =
        isVideoName(file.name) ? web.URL.createObjectURL(captured) : null;
    items.add(
      FolderMediaRef(
        name: file.name,
        size: file.size,
        relativePath: relative.isNotEmpty ? relative : file.name,
        localPath: blobUrl,
        lastModified: DateTime.fromMillisecondsSinceEpoch(file.lastModified),
        readHead: (maxBytes) async {
          final end = math.min(captured.size, maxBytes);
          final blob = captured.slice(0, end);
          final buffer = await blob.arrayBuffer().toDart;
          return buffer.toDart.asUint8List();
        },
      ),
    );
  }

  if (items.isEmpty && !directory) {
    return FolderPickResult(folderName: folderName, items: items);
  }

  return FolderPickResult(
    folderName: items.isEmpty ? folderName : folderName,
    items: items,
  );
}
