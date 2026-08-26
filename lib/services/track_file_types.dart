import 'dart:typed_data';

class PickedTrackFile {
  const PickedTrackFile({required this.name, required this.bytes});

  final String name;
  final Uint8List bytes;
}
