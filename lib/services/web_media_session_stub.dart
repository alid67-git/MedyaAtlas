import 'dart:typed_data';

/// Native: oturum dosyası yok.
void webSessionRegister(String name, int size, Object file) {}

String? webSessionBlobUrl(String name, int size) => null;

Future<Uint8List?> webSessionReadHead(
  String name,
  int size,
  int maxBytes,
) async =>
    null;

void webSessionClear() {}
