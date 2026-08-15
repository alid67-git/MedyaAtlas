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

void webSessionClear() {
  for (final url in _urls.values) {
    try {
      web.URL.revokeObjectURL(url);
    } catch (_) {}
  }
  _urls.clear();
  _files.clear();
}
