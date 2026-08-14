import 'dart:math' as math;

import 'package:flutter/material.dart';

/// V2 harita noktası: sayı arttıkça biraz büyür ve ısınır.
class ClusterDot extends StatelessWidget {
  const ClusterDot({super.key, required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final size = math.min(44.0, 16 + math.sqrt(count) * 5);
    final heat = math.min(1.0, count / 15);
    final color = Color.lerp(
      const Color(0xFFF4D03F),
      const Color(0xFFE74C3C),
      heat,
    )!;

    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color,
        border: Border.all(color: Colors.white, width: 2),
        boxShadow: const [
          BoxShadow(color: Colors.black54, blurRadius: 6, offset: Offset(0, 1)),
        ],
      ),
      child: Text(
        count > 99 ? '99+' : '$count',
        style: TextStyle(
          color: Colors.black87,
          fontSize: size < 22 ? 9 : 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
