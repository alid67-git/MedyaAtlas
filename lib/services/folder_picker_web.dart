import 'dart:async';
import 'dart:js_interop';
import 'dart:math' as math;

import 'package:web/web.dart' as web;

import 'folder_types.dart';

export 'folder_types.dart';

Future<FolderPickResult?> pickMediaFolder() async {
  final input = web.HTMLInputElement()
    ..type = 'file'
    ..multiple = true;
  input.setAttribute('webkitdirectory', '');
  input.setAttribute('directory', '');

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
      finish(_fromFileList(list));
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

FolderPickResult _fromFileList(web.FileList list) {
  final items = <FolderMediaRef>[];
  var folderName = 'klasör';

  for (var i = 0; i < list.length; i++) {
    final file = list.item(i);
    if (file == null) continue;
    final relative = file.webkitRelativePath;
    if (relative.isNotEmpty) {
      folderName = relative.split('/').first;
    }
    if (!isMediaName(file.name)) continue;
    final captured = file;
    items.add(
      FolderMediaRef(
        name: file.name,
        size: file.size,
        relativePath: relative.isNotEmpty ? relative : file.name,
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

  return FolderPickResult(
    folderName: folderName,
    items: items,
  );
}

Future<FolderPickResult> scanMediaDirectory(String dirPath) async {
  throw UnsupportedError('Klasör tarama web’de yok.');
}
