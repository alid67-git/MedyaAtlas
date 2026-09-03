import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../models/library_media.dart';
import '../repositories/media_repository.dart';
import '../services/photo_orient.dart';
import '../services/video_preview.dart';
import 'photo_source.dart';
import 'video_surface.dart';

/// Harita / küre pin: her zaman yuvarlak; kümede önde büyük, arkada küçük daireler.
class PhotoMapPin extends StatelessWidget {
  const PhotoMapPin({
    super.key,
    required this.item,
    required this.repo,
    this.count = 1,
    this.extraCovers = const [],
    this.showTip = true,
  });

  final LibraryMedia item;
  final MediaRepository repo;
  final int count;

  /// Arkadaki ek kapaklar (en fazla 2–3); öndeki [item] en büyük.
  final List<LibraryMedia> extraCovers;
  final bool showTip;

  static const Size markerBox = Size(72, 78);

  @override
  Widget build(BuildContext context) {
    const front = 48.0;
    const tip = 10.0;
    final stack = extraCovers.take(3).toList();
    final height = showTip ? front + tip + 8 : front + 12;
    return SizedBox(
      width: 72,
      height: height,
      child: Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.bottomCenter,
        children: [
          // Arkadan öne: küçük → büyük
          for (var i = 0; i < stack.length; i++)
            Positioned(
              bottom: showTip ? tip + 6 + (stack.length - i) * 3.0 : 8.0 + (stack.length - i) * 3.0,
              left: 8.0 + (i.isEven ? -10.0 - i * 4 : 18.0 + i * 3),
              child: Transform.scale(
                scale: 0.62 + i * 0.08,
                child: _RoundThumb(
                  item: stack[stack.length - 1 - i],
                  repo: repo,
                  size: front * (0.72 + i * 0.06),
                  borderWidth: 2,
                ),
              ),
            ),
          Positioned(
            bottom: showTip ? tip - 1 : 4,
            child: _RoundThumb(
              item: item,
              repo: repo,
              size: front,
              borderWidth: 3,
              count: count > 1 ? count : null,
            ),
          ),
          if (showTip)
            const Positioned(
              bottom: 0,
              child: CustomPaint(
                size: Size(18, tip),
                painter: _PinTipPainter(),
              ),
            ),
        ],
      ),
    );
  }
}

class _RoundThumb extends StatelessWidget {
  const _RoundThumb({
    required this.item,
    required this.repo,
    required this.size,
    this.borderWidth = 3,
    this.count,
  });

  final LibraryMedia item;
  final MediaRepository repo;
  final double size;
  final double borderWidth;
  final int? count;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: const Color(0xFF1A2A36),
        border: Border.all(color: Colors.white, width: borderWidth),
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
            if (count != null && count! > 1)
              Positioned(
                right: 2,
                bottom: 2,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                  decoration: BoxDecoration(
                    color: const Color(0xE0050E16),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    count! > 99 ? '99+' : '$count',
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
    );
  }
}

class _PinTipPainter extends CustomPainter {
  const _PinTipPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(size.width / 2, size.height)
      ..lineTo(0, 0)
      ..lineTo(size.width, 0)
      ..close();
    canvas.drawPath(path, Paint()..color = Colors.white);
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
      if (kIsWeb) {
        return FutureBuilder<String?>(
          future: repo.resolvePlayableUrl(item),
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) {
              return const ColoredBox(color: Color(0xFF1A2A36));
            }
            final fromSession = photoFromPath(snap.data, fit: BoxFit.cover);
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
    // Etiketli pin sayısı zaten sınırlı (_maxPhotoLabels) — foto pinlerle
    // aynı maliyetle Android/Windows'ta da gerçek video karesi gösterilir.
    return VideoThumb(
      path: item.localPath,
      kind: item.kind,
      resolveUrl: () => repo.resolvePlayableUrl(item),
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

/// Küme öğelerinden öndeki kapak + arkadaki 2 ek kapak.
({LibraryMedia cover, List<LibraryMedia> behind}) clusterPinCovers(
  List<LibraryMedia> items,
) {
  if (items.isEmpty) {
    throw ArgumentError('clusterPinCovers boş liste');
  }
  final sorted = [...items]
    ..sort((a, b) {
      final ta = a.takenAt ?? a.addedAt;
      final tb = b.takenAt ?? b.addedAt;
      return tb.compareTo(ta);
    });
  final cover = sorted.first;
  final behind = <LibraryMedia>[];
  for (final m in sorted.skip(1)) {
    if (behind.length >= 2) break;
    if (m.id == cover.id) continue;
    behind.add(m);
  }
  return (cover: cover, behind: behind);
}
