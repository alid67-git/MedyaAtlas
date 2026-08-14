import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/widgets.dart';

import '../services/photo_orient.dart';

Widget? photoFromPath(String? path, {BoxFit fit = BoxFit.contain}) {
  if (path == null || path.isEmpty) return null;
  final file = File(path);
  if (!file.existsSync()) return null;
  return _OrientedFileImage(path: path, fit: fit);
}

class _OrientedFileImage extends StatefulWidget {
  const _OrientedFileImage({required this.path, required this.fit});

  final String path;
  final BoxFit fit;

  @override
  State<_OrientedFileImage> createState() => _OrientedFileImageState();
}

class _OrientedFileImageState extends State<_OrientedFileImage> {
  int _orientation = 1;
  var _ready = false;

  @override
  void initState() {
    super.initState();
    _loadOrientation();
  }

  @override
  void didUpdateWidget(covariant _OrientedFileImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.path != widget.path) {
      _ready = false;
      _orientation = 1;
      _loadOrientation();
    }
  }

  Future<void> _loadOrientation() async {
    try {
      final file = File(widget.path);
      final len = await file.length();
      final raf = await file.open();
      try {
        final n = len < 256 * 1024 ? len : 256 * 1024;
        final head = await raf.read(n);
        final o = await exifOrientationOf(Uint8List.fromList(head));
        if (mounted) {
          setState(() {
            _orientation = o;
            _ready = true;
          });
        }
      } finally {
        await raf.close();
      }
    } catch (_) {
      if (mounted) setState(() => _ready = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final img = Image.file(
      File(widget.path),
      fit: widget.fit,
      gaplessPlayback: true,
    );
    if (!_ready) return img;
    return applyExifOrientation(img, _orientation);
  }
}
