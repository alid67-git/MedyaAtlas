import 'package:flutter/widgets.dart';

/// Web’de sürükle-bırak yok; boş detay tipi.
class DropDoneDetails {
  const DropDoneDetails({this.files = const []});
  final List<DropXFile> files;
}

class DropXFile {
  const DropXFile({this.path = ''});
  final String path;
}

typedef DropDoneHandler = Future<void> Function(DropDoneDetails details);

Widget wrapDropTarget({
  required Widget child,
  required ValueChanged<bool> onDragging,
  required DropDoneHandler onDrop,
}) {
  return child;
}
