import 'dart:io';

import 'package:flutter/widgets.dart';

Widget? photoFromPath(String? path, {BoxFit fit = BoxFit.contain}) {
  if (path == null || path.isEmpty) return null;
  final file = File(path);
  if (!file.existsSync()) return null;
  return Image.file(file, fit: fit);
}
