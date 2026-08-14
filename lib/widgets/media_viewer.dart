import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/library_media.dart';
import '../repositories/media_repository.dart';
import '../services/media_kind.dart';
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
    final repo = context.watch<MediaRepository>();
    final media = _current;
    final taken = media.takenAt;
    final dateText = taken == null
        ? null
        : DateFormat('d MMM yyyy HH:mm').format(taken.toLocal());

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
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
            tooltip: 'Sil',
            onPressed: () async {
              await repo.remove(media.id);
              if (!context.mounted) return;
              Navigator.pop(context);
            },
            icon: const Icon(Icons.delete_outline),
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
      if (!active) {
        return VideoThumb(path: media.localPath, kind: media.kind);
      }
      return VideoPlaybackPane(
        path: media.localPath,
        name: media.name,
        kind: media.kind,
      );
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
    if (cached != null) {
      return _ZoomPhoto(bytes: cached);
    }
    return FutureBuilder<Uint8List?>(
      future: repo.bytesOf(media.id),
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        final bytes = snap.data;
        if (bytes == null) {
          return const Center(
            child: Text(
              'Fotoğraf bulunamadı.',
              style: TextStyle(color: Colors.white54),
            ),
          );
        }
        return _ZoomPhoto(bytes: bytes);
      },
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
        child: Image.memory(bytes, fit: BoxFit.contain),
      ),
    );
  }
}
