import 'dart:async';
import 'dart:js_interop';
import 'dart:math' as math;

import 'package:web/web.dart' as web;

import 'folder_types.dart';
import 'web_media_session.dart';

export 'folder_types.dart';

/// iPhone Safari’de klasör seçimi yok — çoklu foto/video seçici.
/// Masaüstü Chrome’da mümkünse klasör (webkitdirectory) dener.
Future<FolderPickResult?> pickMediaFolder({
  void Function(int found, String currentPath)? onProgress,
  bool Function()? isCancelled,
}) async {
  final folder = await _pickWithInput(directory: true);
  if (folder != null && folder.items.isNotEmpty) return folder;
  return pickMultipleMediaFiles();
}

Future<FolderPickResult?> pickExternalVolume({
  void Function(int found, String currentPath)? onProgress,
  bool Function()? isCancelled,
}) async {
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

/// Galeri / Favoriler: yalnızca çoklu dosya (klasör yok).
Future<FolderPickResult?> pickMultipleMediaFiles() =>
    _pickWithInput(directory: false);

Future<FolderPickResult?> _pickWithInput({required bool directory}) async {
  final input = web.HTMLInputElement()
    ..type = 'file'
    ..multiple = true;
  input.accept = 'image/*,video/*,.jpg,.jpeg,.png,.heic,.heif,.mp4,.mov,.m4v';
  input.style
    ..position = 'fixed'
    ..left = '0'
    ..top = '0'
    ..width = '1px'
    ..height = '1px'
    ..opacity = '0'
    ..pointerEvents = 'none'
    ..zIndex = '-1';
  if (directory) {
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }

  final done = Completer<FolderPickResult?>();

  void finish(FolderPickResult? value) {
    if (!done.isCompleted) done.complete(value);
  }

  void cleanup() {
    try {
      input.remove();
    } catch (_) {}
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

  var focusArmed = false;
  void onFocus(web.Event _) {
    if (!focusArmed || done.isCompleted) return;
    // Kısa bekleme — iptal tespiti; seçimde change zaten bitmiş olur.
    Future<void>.delayed(const Duration(milliseconds: 400), () {
      if (done.isCompleted) return;
      final list = input.files;
      if (list != null && list.length > 0) {
        finish(_fromFileList(list, directory: directory));
        return;
      }
      finish(null);
    });
  }

  web.document.body?.appendChild(input);
  final jsOnFocus = onFocus.toJS;
  web.window.addEventListener('focus', jsOnFocus);
  Future<void>.delayed(const Duration(milliseconds: 300), () {
    focusArmed = true;
  });

  input.click();

  try {
    return await done.future;
  } finally {
    web.window.removeEventListener('focus', jsOnFocus);
    // File referansları webSession’da kalsın — input’u geç sil.
    Future<void>.delayed(const Duration(seconds: 2), cleanup);
  }
}

FolderPickResult _fromFileList(
  web.FileList list, {
  required bool directory,
}) {
  final items = <FolderMediaRef>[];
  var folderName = directory ? 'klasör' : 'Seçilen medya';
  var skipped = 0;

  for (var i = 0; i < list.length; i++) {
    final file = list.item(i);
    if (file == null) continue;
    final relative = file.webkitRelativePath;
    if (relative.isNotEmpty) {
      folderName = relative.split('/').first;
    }
    final mime = file.type;
    final byName = isMediaName(file.name);
    final byMime = mime.startsWith('image/') || mime.startsWith('video/');
    if (!byName && !byMime) {
      skipped++;
      continue;
    }
    final captured = file;
    final name = file.name.trim().isNotEmpty
        ? file.name
        : (mime.startsWith('video/')
            ? 'video_${i + 1}.mp4'
            : 'photo_${i + 1}.jpg');
    final isVid = isVideoName(name) || mime.startsWith('video/');
    // Video: blob/URL üretme (Safari büyük dosyayı hazırlar → yavaş).
    // File oturumda; oynatınca lazy blob.
    webSessionRegister(name, file.size, captured);
    final String? blobUrl;
    if (isVid) {
      blobUrl = null;
    } else {
      blobUrl = web.URL.createObjectURL(captured);
    }
    items.add(
      FolderMediaRef(
        name: name,
        size: file.size,
        relativePath: relative.isNotEmpty ? relative : name,
        localPath: blobUrl,
        mimeType: mime.isNotEmpty ? mime : null,
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
