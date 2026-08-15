import 'dart:js_interop';
import 'dart:typed_data';

import 'package:web/web.dart' as web;

String? createObjectUrlFromBytes(Uint8List bytes, String mimeType) {
  if (bytes.isEmpty) return null;
  final jsBytes = bytes.toJS;
  final blob = web.Blob(
    [jsBytes].toJS,
    web.BlobPropertyBag(type: mimeType),
  );
  return web.URL.createObjectURL(blob);
}

void revokeObjectUrl(String? url) {
  if (url == null || url.isEmpty) return;
  try {
    web.URL.revokeObjectURL(url);
  } catch (_) {}
}
