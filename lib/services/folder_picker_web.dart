import 'dart:async';
import 'dart:js_interop';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:web/web.dart' as web;

import 'folder_types.dart';
import 'host_platform.dart';
import 'track_file_types.dart';
import 'track_parse.dart';
import 'web_media_session.dart';

export 'folder_types.dart';

/// Klasör seçimi: `webkitdirectory` → Dosyalar (iOS 18.4+ harici disk dahil).
///
/// Önemli: Klasör seçildikten sonra Safari tüm alt ağacı native tarafta
/// listeler; 750GB kökte bu uzun sürer ve web’e ilerleme gelmez. Bu yüzden
/// [onProgress] ile durum metni + [isCancelled] ile anında iptal desteklenir.
Future<FolderPickResult?> pickMediaFolder({
  void Function(int found, String currentPath)? onProgress,
  bool Function()? isCancelled,
}) async {
  final folder = await _pickWithInput(
    directory: true,
    onProgress: onProgress,
    isCancelled: isCancelled,
  );
  if (folder != null && folder.hasAnything) return folder;
  if (folder != null) return folder;
  if (hostIsAppleWeb) return null;
  return pickMultipleMediaFiles(
    onProgress: onProgress,
    isCancelled: isCancelled,
  );
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
Future<FolderPickResult?> pickMultipleMediaFiles({
  void Function(int found, String currentPath)? onProgress,
  bool Function()? isCancelled,
}) =>
    _pickWithInput(
      directory: false,
      onProgress: onProgress,
      isCancelled: isCancelled,
    );

bool _looksLikeTrackName(String name) {
  final lower = name.toLowerCase();
  // Büyük diskte .xml içerik koklama yapma — binlerce config okunur.
  return lower.endsWith('.gpx') ||
      lower.endsWith('.kml') ||
      lower.endsWith('.kmz');
}

Future<FolderPickResult?> _pickWithInput({
  required bool directory,
  void Function(int found, String currentPath)? onProgress,
  bool Function()? isCancelled,
}) async {
  final input = web.HTMLInputElement()
    ..type = 'file'
    ..multiple = true;
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
  Timer? cancelPoll;
  Timer? waitTick;
  var waitSecs = 0;

  void finish(FolderPickResult? value) {
    cancelPoll?.cancel();
    waitTick?.cancel();
    if (!done.isCompleted) done.complete(value);
  }

  void cleanup() {
    try {
      input.remove();
    } catch (_) {}
  }

  bool cancelled() => isCancelled?.call() == true;

  Future<void> handleFileList(web.FileList? list) async {
    if (cancelled()) {
      finish(null);
      return;
    }
    if (list == null || list.length == 0) {
      finish(null);
      return;
    }
    onProgress?.call(
      0,
      'Liste alındı (${list.length} dosya) — medya ayrıştırılıyor…',
    );
    try {
      final result = await _fromFileList(
        list,
        directory: directory,
        onProgress: onProgress,
        isCancelled: isCancelled,
      );
      if (cancelled()) {
        finish(null);
        return;
      }
      finish(result);
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

  // İptal: native Dosyalar UI’sini kapatamayız ama Completer’ı hemen bitiririz.
  cancelPoll = Timer.periodic(const Duration(milliseconds: 200), (_) {
    if (done.isCompleted) {
      cancelPoll?.cancel();
      return;
    }
    if (cancelled()) {
      finish(null);
    }
  });

  // Büyük diskte Safari FileList’i geç üretir — 2sn’de vazgeçme.
  // Odak dönünce dosya gelene / iptale kadar bekle; adım metni güncelle.
  var focusArmed = false;
  void onFocus(web.Event _) {
    if (!focusArmed || done.isCompleted) return;
    waitTick?.cancel();
    waitSecs = 0;
    waitTick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (done.isCompleted) {
        waitTick?.cancel();
        return;
      }
      if (cancelled()) {
        finish(null);
        return;
      }
      final list = input.files;
      if (list != null && list.length > 0) {
        waitTick?.cancel();
        handleFileList(list);
        return;
      }
      waitSecs++;
      if (directory) {
        onProgress?.call(
          0,
          waitSecs < 8
              ? 'iOS klasörü listeliyor… (${waitSecs}sn) — kök değil, DCIM/GoPro seçin'
              : 'Hâlâ listeleniyor… (${waitSecs}sn) · 750GB kök çok yavaş · İptal veya küçük klasör',
        );
      }
    });
  }

  web.document.body?.appendChild(input);
  final jsOnFocus = onFocus.toJS;
  web.window.addEventListener('focus', jsOnFocus);
  Future<void>.delayed(const Duration(milliseconds: 300), () {
    focusArmed = true;
  });

  if (directory) {
    onProgress?.call(
      0,
      'Dosyalar: küçük klasör seçin (DCIM / GoPro) — tüm disk kökü çok uzun sürer',
    );
  }

  input.click();

  try {
    return await done.future;
  } finally {
    cancelPoll?.cancel();
    waitTick?.cancel();
    web.window.removeEventListener('focus', jsOnFocus);
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
  void Function(int found, String currentPath)? onProgress,
  bool Function()? isCancelled,
}) async {
  final items = <FolderMediaRef>[];
  final tracks = <PickedTrackFile>[];
  var folderName = directory ? 'klasör' : 'Seçilen medya';
  final total = list.length;

  for (var i = 0; i < total; i++) {
    if (isCancelled?.call() == true) {
      break;
    }
    // UI nefesi + İptal — her 20 dosyada bir.
    if (i % 20 == 0) {
      onProgress?.call(
        items.length,
        'Ayrıştırma ${i + 1}/$total · medya ${items.length} · iz ${tracks.length}',
      );
      await Future<void>.delayed(Duration.zero);
      if (isCancelled?.call() == true) break;
    }

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

    if (!_looksLikeTrackName(name)) continue;
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
