import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/library_media.dart';
import '../repositories/media_repository.dart';
import '../services/host_platform.dart';
import '../services/media_kind.dart';
import '../services/photo_orient.dart';
import '../services/video_preview.dart';
import 'photo_source.dart';
import 'video_surface.dart';

Future<void> openMediaViewer(
  BuildContext context, {
  required List<LibraryMedia> items,
  int initialIndex = 0,
}) {
  if (items.isEmpty) return Future<void>.value();
  final index = initialIndex.clamp(0, items.length - 1);
  return Navigator.of(context).push(
    MaterialPageRoute<void>(
      fullscreenDialog: true,
      builder: (_) => MediaViewer(items: items, initialIndex: index),
    ),
  );
}

class MediaViewer extends StatefulWidget {
  const MediaViewer({
    super.key,
    required this.items,
    this.initialIndex = 0,
  }) : assert(items.length > 0, 'MediaViewer boş liste ile açılamaz');

  final List<LibraryMedia> items;
  final int initialIndex;

  @override
  State<MediaViewer> createState() => _MediaViewerState();
}

class _MediaViewerState extends State<MediaViewer> {
  late final PageController _pages;
  late int _index;

  @override
  void initState() {
    super.initState();
    _index = widget.initialIndex.clamp(0, widget.items.length - 1);
    _pages = PageController(initialPage: _index);
  }

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  LibraryMedia get _current => widget.items[_index];

  @override
  Widget build(BuildContext context) {
    final media = _current;
    final taken = media.takenAt;
    final dateText = taken == null
        ? null
        : DateFormat('d MMM yyyy HH:mm').format(taken.toLocal());

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        automaticallyImplyLeading: false,
        title: Text(media.name, overflow: TextOverflow.ellipsis),
        actions: [
          if (widget.items.length > 1)
            Center(
              child: Padding(
                padding: const EdgeInsets.only(right: 8),
                child: Text('${_index + 1}/${widget.items.length}'),
              ),
            ),
          IconButton(
            tooltip: 'Kapat',
            onPressed: () => Navigator.pop(context),
            icon: const Icon(Icons.close),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: PageView.builder(
              controller: _pages,
              itemCount: widget.items.length,
              onPageChanged: (i) => setState(() => _index = i),
              itemBuilder: (context, i) => _Page(
                media: widget.items[i],
                active: i == _index,
              ),
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: Row(
                children: [
                  Text(kindLabel(media.kind, en: false)),
                  if (dateText != null) ...[
                    const Text(' · '),
                    Flexible(
                      child: Text(dateText, overflow: TextOverflow.ellipsis),
                    ),
                  ],
                  if (!media.hasLocation) ...[
                    const Text(' · '),
                    const Text('GPS yok'),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Page extends StatelessWidget {
  const _Page({required this.media, required this.active});

  final LibraryMedia media;
  final bool active;

  @override
  Widget build(BuildContext context) {
    if (media.isVideo) {
      return _VideoPage(media: media, active: active);
    }

    final fromDisk = photoFromPath(media.localPath);
    if (fromDisk != null) {
      return InteractiveViewer(
        minScale: 1,
        maxScale: 5,
        child: Center(child: fromDisk),
      );
    }
    final repo = context.read<MediaRepository>();
    final cached = repo.cachedBytes(media.id);
    if (cached != null &&
        looksLikeJpeg(cached) &&
        !looksLikeHeic(cached)) {
      return _ZoomPhoto(bytes: cached);
    }
    return FutureBuilder<Uint8List?>(
      future: repo.bytesOf(media.id),
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        final bytes = snap.data;
        if (bytes == null ||
            bytes.isEmpty ||
            looksLikeHeic(bytes) ||
            !looksLikeJpeg(bytes)) {
          return Center(
            child: Text(
              kIsWeb
                  ? 'Fotoğraf yok. Galeriden yeniden seçin (HEIC için blob gerekir).'
                  : 'Fotoğraf bulunamadı.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white54),
            ),
          );
        }
        return _ZoomPhoto(bytes: bytes);
      },
    );
  }
}

class _VideoPage extends StatefulWidget {
  const _VideoPage({required this.media, required this.active});

  final LibraryMedia media;
  final bool active;

  @override
  State<_VideoPage> createState() => _VideoPageState();
}

class _VideoPageState extends State<_VideoPage> {
  Uint8List? _poster;

  @override
  void initState() {
    super.initState();
    _loadPoster();
  }

  @override
  void didUpdateWidget(covariant _VideoPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.media.id != widget.media.id) {
      _poster = null;
      _loadPoster();
    }
  }

  Future<void> _loadPoster() async {
    final repo = context.read<MediaRepository>();
    var bytes = repo.cachedBytes(widget.media.id) ??
        await repo.bytesOf(widget.media.id);
    if (bytes == null || bytes.isEmpty) {
      bytes = await extractVideoPreviewBytes(
        localPath: widget.media.localPath,
        relativePath: widget.media.relativePath,
      );
      if (bytes != null && bytes.isNotEmpty) {
        await repo.putPreviewBytes(widget.media.id, bytes);
      }
    }
    if (mounted) setState(() => _poster = bytes);
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.active) {
      if (_poster != null) {
        return OrientedMemoryImage(_poster!, fit: BoxFit.contain);
      }
      return const Center(child: CircularProgressIndicator());
    }
    final repo = context.read<MediaRepository>();
    return VideoPlaybackPane(
      path: widget.media.localPath,
      name: widget.media.name,
      kind: widget.media.kind,
      posterBytes: _poster,
      resolveUrl: () => repo.resolvePlayableUrl(widget.media),
      // GoPro/DJI HEVC: yalnızca Windows’ta önce dış oynatıcı.
      preferExternal: hostIsWindows &&
          (widget.media.kind == MediaKind.gopro ||
              widget.media.kind == MediaKind.drone),
    );
  }
}

class _ZoomPhoto extends StatelessWidget {
  const _ZoomPhoto({required this.bytes});

  final Uint8List bytes;

  @override
  Widget build(BuildContext context) {
    return InteractiveViewer(
      minScale: 1,
      maxScale: 5,
      child: Center(
        child: OrientedMemoryImage(bytes, fit: BoxFit.contain),
      ),
    );
  }
}
