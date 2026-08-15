import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Google Fotoğraflar tarzı yumuşak ısı lekesi (mavi → mor → sarı çekirdek).
class HeatBlob extends StatelessWidget {
  const HeatBlob({super.key, required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final n = count.clamp(1, 500);
    final size = math.min(88.0, 36 + math.sqrt(n) * 9);
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
      width: size,
      height: size,
      child: CustomPaint(
        painter: _HeatBlobPainter(
          outer: outer,
          mid: mid,
          core: core,
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
  });

  final Color outer;
  final Color mid;
  final Color core;

  @override
  void paint(Canvas canvas, Size size) {
    final c = Offset(size.width / 2, size.height / 2);
    final r = size.shortestSide / 2;

    final glow = Paint()
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 10);
    glow.shader = RadialGradient(
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
      oldDelegate.core != core;
}

/// Eski sayı rozeti — ısı lekesine yönlendir.
class ClusterDot extends StatelessWidget {
  const ClusterDot({super.key, required this.count});

  final int count;

  @override
  Widget build(BuildContext context) => HeatBlob(count: count);
}
