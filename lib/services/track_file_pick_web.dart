import 'dart:async';
import 'dart:js_interop';

import 'package:web/web.dart' as web;

import 'track_file_types.dart';
import 'track_parse.dart';

export 'track_file_types.dart';

/// Safari-safe track picker: keep `<input>` in the DOM until change/cancel.
///
/// Document-only [accept] so iOS shows Files ("Choose Files") — not Photo
/// Library / Camera. Empty accept was causing that media action sheet.
const _trackAccept = '.gpx,.kml,.kmz,'
    'application/gpx+xml,'
    'application/vnd.google-earth.kml+xml,'
    'application/vnd.google-earth.kmz,'
    'application/xml,text/xml';

Future<List<PickedTrackFile>?> pickTrackFiles() async {
  final done = Completer<List<PickedTrackFile>?>();
  final input = web.HTMLInputElement()
    ..type = 'file'
    ..multiple = true
    ..accept = _trackAccept;
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

  void finish(List<PickedTrackFile>? value) {
    if (!done.isCompleted) done.complete(value);
  }

  void cleanup() {
    try {
      input.remove();
    } catch (_) {}
  }

  Future<void> readFiles(web.FileList list) async {
    final out = <PickedTrackFile>[];
    for (var i = 0; i < list.length; i++) {
      final file = list.item(i);
      if (file == null) continue;
      if (!isTrackFileName(file.name)) continue;
      try {
        final buffer = await file.arrayBuffer().toDart;
        out.add(
          PickedTrackFile(
            name: file.name,
            bytes: buffer.toDart.asUint8List(),
          ),
        );
      } catch (_) {
        /* skip unreadable */
      }
    }
    finish(out);
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
