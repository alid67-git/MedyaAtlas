import 'dart:js_interop';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:web/web.dart' as web;

final Map<String, web.File> _files = {};
final Map<String, String> _urls = {};

String _key(String name, int size) => '$name|$size';

/// Seçim anında File tut — içerik okunmaz, blob sonra (oynatınca) üretilir.
void webSessionRegister(String name, int size, Object file) {
  // ignore: avoid_dynamic_calls — package:web File from picker
  _files[_key(name, size)] = file as dynamic;
}

/// İlk oynatmada / gösterimde blob URL (lazy).
String? webSessionBlobUrl(String name, int size) {
  final k = _key(name, size);
  final existing = _urls[k];
  if (existing != null) return existing;
  final file = _files[k];
  if (file == null) return null;
  final url = web.URL.createObjectURL(file);
  _urls[k] = url;
  return url;
}

/// Oturumdaki File'dan baştan `maxBytes` oku — GPS/EXIF için (iOS/Safari dahil
/// hiçbir dosya yolu yok, tek erişim bu bellek referansı).
Future<Uint8List?> webSessionReadHead(
  String name,
  int size,
  int maxBytes,
) async {
  final file = _files[_key(name, size)];
  if (file == null) return null;
  final end = math.min(file.size, maxBytes);
  final blob = file.slice(0, end);
  final buffer = await blob.arrayBuffer().toDart;
  return buffer.toDart.asUint8List();
}

void webSessionClear() {
  for (final url in _urls.values) {
    try {
      web.URL.revokeObjectURL(url);
    } catch (_) {}
  }
  _urls.clear();
  _files.clear();
}
