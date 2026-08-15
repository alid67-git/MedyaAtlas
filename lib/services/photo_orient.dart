import 'dart:typed_data';

import 'package:exif/exif.dart';
import 'package:flutter/material.dart';

/// EXIF Orientation (1–8). Yoksa 1.
Future<int> exifOrientationOf(Uint8List bytes) async {
  try {
    final tags = await readExifFromBytes(bytes);
    if (tags.isEmpty) return 1;
    final tag = tags['Image Orientation'];
    if (tag == null) return 1;
    final printable = tag.printable;
    final fromPrint = _orientationFromPrintable(printable);
    if (fromPrint != null) return fromPrint;
    final parsed = int.tryParse(printable.trim());
    if (parsed != null && parsed >= 1 && parsed <= 8) return parsed;
    try {
      final list = tag.values.toList();
      if (list.isNotEmpty) {
        final n = int.tryParse(list.first.toString());
        if (n != null && n >= 1 && n <= 8) return n;
      }
    } catch (_) {}
    return 1;
  } catch (_) {
    return 1;
  }
}

int? _orientationFromPrintable(String s) {
  final t = s.toLowerCase();
  if (t.contains('horizontal') || t == '1' || t.contains('normal')) return 1;
  if (t.contains('mirror') && t.contains('horizontal')) return 2;
  if (t.contains('180') || t == '3') return 3;
  if (t.contains('mirror') && t.contains('vertical')) return 4;
  if (t.contains('90') && t.contains('cw') && t.contains('mirror')) return 5;
  if ((t.contains('90') && t.contains('cw')) ||
      t.contains('rotate 90 cw') ||
      t == '6') {
    return 6;
  }
  if (t.contains('90') && t.contains('ccw') && t.contains('mirror')) return 7;
  if ((t.contains('90') && t.contains('ccw')) ||
      t.contains('rotate 270') ||
      t == '8') {
    return 8;
  }
  return null;
}

Widget applyExifOrientation(Widget child, int orientation) {
  switch (orientation) {
    case 2:
      return Transform(
        alignment: Alignment.center,
        transform: Matrix4.diagonal3Values(-1, 1, 1),
        child: child,
      );
    case 3:
      return RotatedBox(quarterTurns: 2, child: child);
    case 4:
      return Transform(
        alignment: Alignment.center,
        transform: Matrix4.diagonal3Values(1, -1, 1),
        child: child,
      );
    case 5:
      return RotatedBox(
        quarterTurns: 1,
        child: Transform(
          alignment: Alignment.center,
          transform: Matrix4.diagonal3Values(-1, 1, 1),
          child: child,
        ),
      );
    case 6:
      return RotatedBox(quarterTurns: 1, child: child);
    case 7:
      return RotatedBox(
        quarterTurns: 3,
        child: Transform(
          alignment: Alignment.center,
          transform: Matrix4.diagonal3Values(-1, 1, 1),
          child: child,
        ),
      );
    case 8:
      return RotatedBox(quarterTurns: 3, child: child);
    default:
      return child;
  }
}

/// EXIF yönüne göre düzeltilmiş görüntü (bellek).
class OrientedMemoryImage extends StatelessWidget {
  const OrientedMemoryImage(
    this.bytes, {
    super.key,
    this.fit = BoxFit.contain,
  });

  final Uint8List bytes;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<int>(
      future: exifOrientationOf(bytes),
      builder: (context, snap) {
        final img = Image.memory(
          bytes,
          fit: fit,
          gaplessPlayback: true,
          errorBuilder: (context, error, stackTrace) => const ColoredBox(
            color: Color(0xFF1A2A36),
            child: Icon(Icons.broken_image_outlined, color: Color(0x88FFFFFF)),
          ),
        );
        return applyExifOrientation(img, snap.data ?? 1);
      },
    );
  }
}
