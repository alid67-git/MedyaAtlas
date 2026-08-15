import 'package:flutter/material.dart';

import '../services/media_mime.dart';

/// Web: blob:/http(s) — Safari HEIC’i img ile çözer; hata/yüklemede ikon.
Widget? photoFromPath(String? path, {BoxFit fit = BoxFit.contain}) {
  if (!isWebPlayableUrl(path)) return null;
  return Image.network(
    path!,
    fit: fit,
    gaplessPlayback: true,
    loadingBuilder: (context, child, progress) {
      if (progress == null) return child;
      return const ColoredBox(
        color: Color(0xFF1A2A36),
        child: Center(
          child: SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    },
    errorBuilder: (context, error, stackTrace) => const ColoredBox(
      color: Color(0xFF1A2A36),
      child: Icon(Icons.broken_image_outlined, color: Colors.white54),
    ),
  );
}
