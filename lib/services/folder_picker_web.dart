import 'dart:async';
import 'dart:js_interop';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:web/web.dart' as web;

import 'folder_types.dart';
import 'host_platform.dart';
import 'track_parse.dart';
import 'web_media_session.dart';

export 'folder_types.dart';

/// Klasör seçimi: `webkitdirectory` → Dosyalar uygulaması (iOS 18.4+ harici
/// disk / USB-C HDD dahil). Alt klasörler FileList + webkitRelativePath ile gelir.
/// Eski iOS’ta iptal/boş dönünce Apple web’de ikinci seçici açılmaz.
Future<FolderPickResult?> pickMediaFolder({
  void Function(int found, String currentPath)? onProgress,
  bool Function()? isCancelled,
}) async {
  final folder = await _pickWithInput(directory: true);
  if (folder != null && folder.hasAnything) return folder;
  if (folder != null) return folder; // boş klasör seçildi
  // iPhone: kullanıcı iptal etti veya klasör API yok — foto seçiciye düşme.
  if (hostIsAppleWeb) return null;
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

bool _looksLikeTrackName(String name) {
  final lower = name.toLowerCase();
  return lower.endsWith('.gpx') ||
      lower.endsWith('.kml') ||
      lower.endsWith('.kmz') ||
      lower.endsWith('.xml');
}

Future<FolderPickResult?> _pickWithInput({required bool directory}) async {
  final input = web.HTMLInputElement()
    ..type = 'file'
    ..multiple = true;
  // Klasör modunda accept daraltma: Safari tüm alt dosyaları (GPX dahil) getirsin.
  if (directory) {
    input.removeAttribute('accept');
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  } else {
    input.accept = 'image/*,video/*,.jpg,.jpeg,.png,.heic,.heif,.mp4,.mov,.m4v';
  }
  input.style
    ..position = 'fixed'
    ..left = '0'
    ..top = '0'
    ..width = '1px'
    ..height = '1px'
    ..opacity = '0'
    ..pointerEvents = 'none'
    ..zIndex = '-1';

  final done = Completer<FolderPickResult?>();

  void finish(FolderPickResult? value) {
    if (!done.isCompleted) done.complete(value);
  }

  void cleanup() {
    try {
      input.remove();
    } catch (_) {}
  }

  Future<void> handleFileList(web.FileList? list) async {
    if (list == null || list.length == 0) {
      finish(null);
      return;
    }
    try {
      finish(await _fromFileList(list, directory: directory));
    } catch (_) {
      finish(null);
    }
  }

  input.addEventListener(
    'change',
    (web.Event _) {
      handleFileList(input.files);
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
    // Not: büyük klasörlerde change gecikebilir; 2s'ye kadar bekle.
    Future<void>.delayed(const Duration(milliseconds: 2000), () {
      if (done.isCompleted) return;
      final list = input.files;
      if (list != null && list.length > 0) {
        handleFileList(list);
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

Future<Uint8List?> _readWholeFile(web.File file) async {
  try {
    if (file.size > trackFileMaxBytes) return null;
    if (file.size <= 32 * 1024 * 1024) {
      final buffer = await file.arrayBuffer().toDart;
      return buffer.toDart.asUint8List();
    }
    final out = BytesBuilder(copy: false);
    const chunk = 4 * 1024 * 1024;
    var offset = 0;
    while (offset < file.size) {
      final end = offset + chunk > file.size ? file.size : offset + chunk;
      final part = file.slice(offset, end);
      final buffer = await part.arrayBuffer().toDart;
      out.add(buffer.toDart.asUint8List());
      offset = end;
    }
    return out.takeBytes();
  } catch (_) {
    return null;
  }
}

Future<FolderPickResult> _fromFileList(
  web.FileList list, {
  required bool directory,
}) async {
  final items = <FolderMediaRef>[];
  final tracks = <PickedTrackFile>[];
  var folderName = directory ? 'klasör' : 'Seçilen medya';

  for (var i = 0; i < list.length; i++) {
    final file = list.item(i);
    if (file == null) continue;
    final relative = file.webkitRelativePath;
    if (relative.isNotEmpty) {
      folderName = relative.split('/').first;
    }
    final mime = file.type;
    final name = file.name.trim().isNotEmpty
        ? file.name
        : (mime.startsWith('video/')
            ? 'video_${i + 1}.mp4'
            : 'photo_${i + 1}.jpg');

    final byName = isMediaName(name);
    final byMime = mime.startsWith('image/') || mime.startsWith('video/');
    if (byName || byMime) {
      final captured = file;
      webSessionRegister(name, file.size, captured);
      final blobUrl = web.URL.createObjectURL(captured);
      webSessionRememberBlob(blobUrl);
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
      continue;
    }

    // Klasördeki route dosyaları — uzantı veya (xml) içerik.
    if (!directory && !_looksLikeTrackName(name)) continue;
    if (directory &&
        !_looksLikeTrackName(name) &&
        !mime.contains('gpx') &&
        !mime.contains('kml') &&
        mime != 'application/xml' &&
        mime != 'text/xml') {
      continue;
    }
    final bytes = await _readWholeFile(file);
    if (bytes == null || bytes.isEmpty) continue;
    final kind = detectTrackFormat(fileName: name, bytes: bytes);
    if (kind == null) continue;
    tracks.add(
      PickedTrackFile(
        name: ensureTrackExtension(name, kind),
        bytes: bytes,
      ),
    );
  }

  return FolderPickResult(
    folderName: folderName,
    items: items,
    trackFiles: tracks,
  );
}
