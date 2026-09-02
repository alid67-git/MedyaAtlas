import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Google Fotoğraflar tarzı yumuşak ısı lekesi (mavi → mor → sarı çekirdek).
///
/// MaskFilter.blur yok — pan/zoom’da yüzlerce lekede ANR yapıyordu.
class HeatBlob extends StatelessWidget {
  const HeatBlob({super.key, required this.count});

  final int count;

  /// Görsel çap (piksel).
  static double sizeFor(int count) {
    final n = count.clamp(1, 500);
    return math.min(64.0, 28 + math.sqrt(n) * 7);
  }

  /// Gradient taşması için Marker kutusu payı.
  static const glowPadding = 12.0;

  static double markerSizeFor(int count) => sizeFor(count) + glowPadding;

  @override
  Widget build(BuildContext context) {
    final n = count.clamp(1, 500);
    final size = sizeFor(n);
    final heat = math.min(1.0, math.log(n + 1) / math.log(40));

    final outer = Color.lerp(
      const Color(0x8840A0FF),
      const Color(0xAA7B5CFF),
      heat,
    )!;
    final mid = Color.lerp(
      const Color(0xCC7B5CFF),
      const Color(0xEEFF5CA8),
      heat,
    )!;
    final core = Color.lerp(
      const Color(0xDDFF8A5C),
      const Color(0xFFF5E64A),
      heat,
    )!;

    return SizedBox(
      width: size + glowPadding,
      height: size + glowPadding,
      child: CustomPaint(
        isComplex: true,
        willChange: false,
        painter: _HeatBlobPainter(
          outer: outer,
          mid: mid,
          core: core,
          blobDiameter: size,
        ),
      ),
    );
  }
}

class _HeatBlobPainter extends CustomPainter {
  _HeatBlobPainter({
    required this.outer,
    required this.mid,
    required this.core,
    required this.blobDiameter,
  });

  final Color outer;
  final Color mid;
  final Color core;
  final double blobDiameter;

  @override
  void paint(Canvas canvas, Size size) {
    final c = Offset(size.width / 2, size.height / 2);
    final r = blobDiameter / 2;

    // Soft edge yalnızca RadialGradient ile — blur mask yok.
    final glow = Paint()
      ..shader = RadialGradient(
        colors: [
          core.withValues(alpha: 0.95),
          mid.withValues(alpha: 0.55),
          outer.withValues(alpha: 0.22),
          outer.withValues(alpha: 0.0),
        ],
        stops: const [0.0, 0.28, 0.62, 1.0],
      ).createShader(Rect.fromCircle(center: c, radius: r));
    canvas.drawCircle(c, r, glow);

    final solid = Paint()
      ..shader = RadialGradient(
        colors: [
          core,
          mid.withValues(alpha: 0.75),
          outer.withValues(alpha: 0.0),
        ],
        stops: const [0.0, 0.35, 1.0],
      ).createShader(Rect.fromCircle(center: c, radius: r * 0.72));
    canvas.drawCircle(c, r * 0.72, solid);
  }

  @override
  bool shouldRepaint(covariant _HeatBlobPainter oldDelegate) =>
      oldDelegate.outer != outer ||
      oldDelegate.mid != mid ||
      oldDelegate.core != core ||
      oldDelegate.blobDiameter != blobDiameter;

  @override
  bool shouldRebuildSemantics(covariant _HeatBlobPainter oldDelegate) => false;
}

/// Eski sayı rozeti — ısı lekesine yönlendir.
class ClusterDot extends StatelessWidget {
  const ClusterDot({super.key, required this.count});

  final int count;

  @override
  Widget build(BuildContext context) => HeatBlob(count: count);
}
