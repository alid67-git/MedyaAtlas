import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../models/library_media.dart';
import '../repositories/media_repository.dart';
import '../services/app_settings.dart';
import '../services/photo_orient.dart';
import '../services/video_preview.dart';
import 'photo_source.dart';
import 'video_surface.dart';

/// Harita pin: yuvarlak (uçlu) veya düzlem (hafif eğik kare) fotoğraf.
class PhotoMapPin extends StatelessWidget {
  const PhotoMapPin({
    super.key,
    required this.item,
    required this.repo,
    this.count = 1,
    this.shape = MapPinShape.round,
  });

  final LibraryMedia item;
  final MediaRepository repo;
  final int count;
  final MapPinShape shape;

  /// Marker kutusu (flutter_map).
  static Size markerBox(MapPinShape shape) => switch (shape) {
        MapPinShape.round => const Size(56, 68),
        MapPinShape.square => const Size(58, 58),
      };

  @override
  Widget build(BuildContext context) {
    return switch (shape) {
      MapPinShape.round => _RoundPin(item: item, repo: repo, count: count),
      MapPinShape.square => _SquarePin(item: item, repo: repo, count: count),
    };
  }
}

class _RoundPin extends StatelessWidget {
  const _RoundPin({
    required this.item,
    required this.repo,
    required this.count,
  });

  final LibraryMedia item;
  final MediaRepository repo;
  final int count;

  @override
  Widget build(BuildContext context) {
    const pin = 48.0;
    const tip = 10.0;
    // Marker kutusuyla aynı boyut — Column taşması / sıfır boyut olmasın.
    return SizedBox(
      width: 56,
      height: 68,
      child: Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.bottomCenter,
        children: [
          Positioned(
            bottom: tip - 1,
            child: Container(
              width: pin,
              height: pin,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: const Color(0xFF1A2A36),
                border: Border.all(color: Colors.white, width: 3),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x66000000),
                    blurRadius: 6,
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
                        child: _CountChip(count: count, compact: true),
                      ),
                  ],
                ),
              ),
            ),
          ),
          Positioned(
            bottom: 0,
            child: CustomPaint(
              size: const Size(18, tip),
              painter: _PinTipPainter(),
            ),
          ),
        ],
      ),
    );
  }
}

class _SquarePin extends StatelessWidget {
  const _SquarePin({
    required this.item,
    required this.repo,
    required this.count,
  });

  final LibraryMedia item;
  final MediaRepository repo;
  final int count;

  @override
  Widget build(BuildContext context) {
    const side = 44.0;
    // Hafif eğim — FotoMap tarzı dağınık kareler.
    final tilt = ((item.id.hashCode % 17) - 8) * 0.035;
    return SizedBox(
      width: 58,
      height: 58,
      child: Center(
        child: Transform.rotate(
          angle: tilt,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Container(
                width: side,
                height: side,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(3),
                  border: Border.all(color: Colors.white, width: 2.5),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x55000000),
                      blurRadius: 6,
                      offset: Offset(0, 2),
                    ),
                  ],
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(1),
                  child: _PinThumb(item: item, repo: repo),
                ),
              ),
              if (count > 1)
                Positioned(
                  right: -4,
                  top: -4,
                  child: _CountBadge(count: count),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CountChip extends StatelessWidget {
  const _CountChip({required this.count, this.compact = false});

  final int count;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 5 : 6,
        vertical: compact ? 1 : 2,
      ),
      decoration: BoxDecoration(
        color: const Color(0xE0050E16),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        count > 99 ? '99+' : '$count',
        style: TextStyle(
          color: Colors.white,
          fontSize: compact ? 10 : 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _CountBadge extends StatelessWidget {
  const _CountBadge({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final label = count > 99 ? '99+' : '$count';
    return Container(
      constraints: const BoxConstraints(minWidth: 20, minHeight: 20),
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
      decoration: BoxDecoration(
        color: const Color(0xFF2EC4B6),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: Colors.white, width: 1.5),
        boxShadow: const [
          BoxShadow(color: Color(0x44000000), blurRadius: 3),
        ],
      ),
      child: Text(
        label,
        textAlign: TextAlign.center,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 10,
          fontWeight: FontWeight.w800,
          height: 1.1,
        ),
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
      // Web: eski oturumdan kalma blob: yolu şekli hâlâ geçerli görünür ama
      // sayfa kapanınca ölür — mevcut oturumdan doğrula/tazele.
      if (kIsWeb) {
        return FutureBuilder<String?>(
          future: repo.resolvePlayableUrl(item),
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) {
              return const ColoredBox(color: Color(0xFF1A2A36));
            }
            final fromSession =
                photoFromPath(snap.data, fit: BoxFit.cover);
            if (fromSession != null) return fromSession;
            return _pinBytesFallback(item: item, repo: repo);
          },
        );
      }
      final fromDisk = photoFromPath(item.localPath, fit: BoxFit.cover);
      if (fromDisk != null) return fromDisk;
      return _pinBytesFallback(item: item, repo: repo);
    }
    final cached = repo.cachedBytes(item.id);
    if (cached != null) {
      return OrientedMemoryImage(cached, fit: BoxFit.cover);
    }
    // Web video: oturum blob’undan ilk kare; yoksa kamera ikonu.
    if (kIsWeb) {
      return VideoThumb(
        path: item.localPath,
        kind: item.kind,
        resolveUrl: () => repo.resolvePlayableUrl(item),
      );
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

  Widget _pinBytesFallback({
    required LibraryMedia item,
    required MediaRepository repo,
  }) {
    final cached = repo.cachedBytes(item.id);
    if (cached != null &&
        looksLikeJpeg(cached) &&
        !looksLikeHeic(cached)) {
      return OrientedMemoryImage(cached, fit: BoxFit.cover);
    }
    return FutureBuilder(
      future: repo.bytesOf(item.id),
      builder: (context, snap) {
        final bytes = snap.data;
        if (bytes == null ||
            bytes.isEmpty ||
            looksLikeHeic(bytes) ||
            !looksLikeJpeg(bytes)) {
          return const ColoredBox(
            color: Color(0xFF1A2A36),
            child: Icon(Icons.photo, color: Colors.white54, size: 22),
          );
        }
        return OrientedMemoryImage(bytes, fit: BoxFit.cover);
      },
    );
  }
}
