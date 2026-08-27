import 'dart:async';
import 'dart:js_interop';
import 'dart:typed_data';

import 'package:web/web.dart' as web;

import 'track_file_types.dart';

export 'track_file_types.dart';

/// iPhone Safari: yalnızca uzantı — MIME/octet-stream Fotoğraflar’ı açtırır.
/// Android Chrome web: aynı accept Dosyalar/İndirilenler’e yönlendirir.
const _trackAccept = '.gpx,.kml,.kmz';

Future<TrackPickResult?> pickTrackFiles() async {
  final done = Completer<TrackPickResult?>();
  final input = web.HTMLInputElement()
    ..type = 'file'
    ..multiple = true
    ..accept = _trackAccept;
  // Galeri/kamera tetikleyicisi olmasın.
  input.removeAttribute('capture');
  input.style
    ..position = 'fixed'
    ..left = '0'
    ..top = '0'
    ..width = '1px'
    ..height = '1px'
    ..opacity = '0'
    ..pointerEvents = 'none'
    ..zIndex = '-1';

  web.document.body?.appendChild(input);

  void finish(TrackPickResult? value) {
    if (!done.isCompleted) done.complete(value);
  }

  void cleanup() {
    try {
      input.remove();
    } catch (_) {}
  }

  Future<Uint8List?> readFile(web.File file) async {
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

  Future<void> readFiles(web.FileList list) async {
    final out = <PickedTrackFile>[];
    var wrongType = 0;
    var unreadable = 0;
    var tooLarge = 0;
    var sawMedia = false;
    for (var i = 0; i < list.length; i++) {
      final file = list.item(i);
      if (file == null) continue;
      if (file.size > trackFileMaxBytes) {
        tooLarge++;
        continue;
      }
      final bytes = await readFile(file);
      if (bytes == null || bytes.isEmpty) {
        unreadable++;
        continue;
      }
      final name = file.name.trim().isEmpty ? 'track_$i' : file.name;
      if (!isAcceptableTrackFile(name: name, bytes: bytes)) {
        wrongType++;
        if (looksLikeImageOrVideoName(name) || looksLikeImageBytes(bytes)) {
          sawMedia = true;
        }
        continue;
      }
      out.add(PickedTrackFile(name: name, bytes: bytes));
    }
    finish(
      TrackPickResult(
        files: out,
        skippedWrongType: wrongType,
        skippedUnreadable: unreadable,
        skippedTooLarge: tooLarge,
        skippedSawMedia: sawMedia,
      ),
    );
  }

  input.addEventListener(
    'change',
    (web.Event _) {
      final list = input.files;
      if (list == null || list.length == 0) {
        finish(null);
        return;
      }
      unawaited(readFiles(list));
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
    Future<void>.delayed(const Duration(milliseconds: 400), () {
      if (done.isCompleted) return;
      final list = input.files;
      if (list != null && list.length > 0) {
        unawaited(readFiles(list));
        return;
      }
      finish(null);
    });
  }

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
    Future<void>.delayed(const Duration(seconds: 2), cleanup);
  }
}
