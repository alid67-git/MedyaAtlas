import 'package:flutter/widgets.dart';

import '../services/media_mime.dart';

/// Web: blob:/http(s) yolları Image.network ile; dosya yolu yok.
Widget? photoFromPath(String? path, {BoxFit fit = BoxFit.contain}) {
  if (!isWebPlayableUrl(path)) return null;
  return Image.network(
    path!,
    fit: fit,
    gaplessPlayback: true,
    errorBuilder: (_, error, stackTrace) => const SizedBox.shrink(),
  );
}
