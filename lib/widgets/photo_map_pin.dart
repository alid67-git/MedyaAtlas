import 'package:flutter/material.dart';

import '../models/library_media.dart';
import '../repositories/media_repository.dart';
import '../services/photo_orient.dart';
import 'photo_source.dart';

/// Seçili konum: dairesel fotoğraf + altta konum ucu (Google Fotoğraflar pin).
class PhotoMapPin extends StatelessWidget {
  const PhotoMapPin({
    super.key,
    required this.item,
    required this.repo,
    this.count = 1,
  });

  final LibraryMedia item;
  final MediaRepository repo;
  final int count;

  @override
  Widget build(BuildContext context) {
    const pin = 58.0;
    const tip = 10.0;
    return SizedBox(
      width: pin,
      height: pin + tip,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: pin,
            height: pin,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 3),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x66000000),
                  blurRadius: 8,
                  offset: Offset(0, 2),
                ),
              ],
            ),
            child: ClipOval(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  _PinThumb(item: item, repo: repo),
                  if (count > 1)
                    Positioned(
                      right: 2,
                      bottom: 2,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 5,
                          vertical: 1,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xE0050E16),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          count > 99 ? '99+' : '$count',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          CustomPaint(
            size: const Size(16, tip),
            painter: _PinTipPainter(),
          ),
        ],
      ),
    );
  }
}

class _PinTipPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(size.width / 2, size.height)
      ..lineTo(0, 0)
      ..lineTo(size.width, 0)
      ..close();
    canvas.drawPath(
      path,
      Paint()..color = Colors.white,
    );
    canvas.drawPath(
      path,
      Paint()
        ..color = const Color(0x33000000)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 0.5,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _PinThumb extends StatelessWidget {
  const _PinThumb({required this.item, required this.repo});

  final LibraryMedia item;
  final MediaRepository repo;

  @override
  Widget build(BuildContext context) {
    if (!item.isVideo) {
      final fromDisk = photoFromPath(item.localPath, fit: BoxFit.cover);
      if (fromDisk != null) return fromDisk;
      final cached = repo.cachedBytes(item.id);
      if (cached != null) {
        return OrientedMemoryImage(cached, fit: BoxFit.cover);
      }
      return FutureBuilder(
        future: repo.bytesOf(item.id),
        builder: (context, snap) {
          final bytes = snap.data;
          if (bytes == null) {
            return const ColoredBox(
              color: Color(0xFF1A2A36),
              child: Icon(Icons.photo, color: Colors.white54, size: 22),
            );
          }
          return OrientedMemoryImage(bytes, fit: BoxFit.cover);
        },
      );
    }
    final cached = repo.cachedBytes(item.id);
    if (cached != null) {
      return OrientedMemoryImage(cached, fit: BoxFit.cover);
    }
    return ColoredBox(
      color: const Color(0xFF1A2A36),
      child: Icon(
        item.kind == MediaKind.drone ? Icons.flight : Icons.videocam,
        color: Colors.white54,
        size: 22,
      ),
    );
  }
}
