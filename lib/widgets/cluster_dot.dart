import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Küçük, net konum vurgusu — büyük bulanık leke değil.
class HeatBlob extends StatelessWidget {
  const HeatBlob({super.key, required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final n = count.clamp(1, 500);
    // Dünya ölçeğinde de abartısız; yoğunlukta hafif büyür.
    final size = math.min(36.0, 16 + math.sqrt(n) * 2.8);
    final heat = math.min(1.0, math.log(n + 1) / math.log(50));

    // Magenta → amber çekirdek — sarı iz ve mavi haritadan ayrılır.
    final ring = Color.lerp(
      const Color(0xFFE11D48),
      const Color(0xFFF97316),
      heat,
    )!;
    final core = Color.lerp(
      const Color(0xFFFF4D6D),
      const Color(0xFFFBBF24),
      heat,
    )!;

    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _HeatBlobPainter(ring: ring, core: core, count: n),
      ),
    );
  }
}

class _HeatBlobPainter extends CustomPainter {
  _HeatBlobPainter({
    required this.ring,
    required this.core,
    required this.count,
  });

  final Color ring;
  final Color core;
  final int count;

  @override
  void paint(Canvas canvas, Size size) {
    final c = Offset(size.width / 2, size.height / 2);
    final r = size.shortestSide / 2;

    // Hafif dış halo (az blur — düzensiz büyük leke olmasın).
    final halo = Paint()
      ..color = ring.withValues(alpha: 0.35)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 2.5);
    canvas.drawCircle(c, r, halo);

    canvas.drawCircle(
      c,
      r * 0.78,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.6,
    );
    canvas.drawCircle(c, r * 0.72, Paint()..color = ring);
    canvas.drawCircle(c, r * 0.38, Paint()..color = core);

    if (count > 1) {
      final label = count > 99 ? '99+' : '$count';
      final tp = TextPainter(
        text: TextSpan(
          text: label,
          style: TextStyle(
            color: Colors.white,
            fontSize: math.max(8.0, r * 0.55),
            fontWeight: FontWeight.w800,
            height: 1,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      tp.paint(canvas, c - Offset(tp.width / 2, tp.height / 2));
    }
  }

  @override
  bool shouldRepaint(covariant _HeatBlobPainter oldDelegate) =>
      oldDelegate.ring != ring ||
      oldDelegate.core != core ||
      oldDelegate.count != count;
}

/// Eski sayı rozeti — ısı lekesine yönlendir.
class ClusterDot extends StatelessWidget {
  const ClusterDot({super.key, required this.count});

  final int count;

  @override
  Widget build(BuildContext context) => HeatBlob(count: count);
}
