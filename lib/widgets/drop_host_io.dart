import 'package:desktop_drop/desktop_drop.dart';
import 'package:flutter/widgets.dart';

export 'package:desktop_drop/desktop_drop.dart' show DropDoneDetails;

typedef DropDoneHandler = Future<void> Function(DropDoneDetails details);

Widget wrapDropTarget({
  required Widget child,
  required ValueChanged<bool> onDragging,
  required DropDoneHandler onDrop,
}) {
  return DropTarget(
    onDragEntered: (_) => onDragging(true),
    onDragExited: (_) => onDragging(false),
    onDragDone: (d) async {
      onDragging(false);
      await onDrop(d);
    },
    child: child,
  );
}
