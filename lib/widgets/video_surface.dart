import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:video_player/video_player.dart';

import '../models/library_media.dart';
import '../services/host_platform.dart';
import '../services/photo_orient.dart';
import 'process_host.dart';
import 'video_file.dart';

IconData kindVideoIcon(MediaKind kind) =>
    kind == MediaKind.drone ? Icons.flight : Icons.videocam;

String _externalReopenLabel() {
  if (hostIsAndroid) return 'Yeniden aç';
  if (hostIsWindows) return 'Windows’ta aç';
  return 'Sistem oynatıcıda aç';
}

/// Sağ panel / ızgara için ilk kare (sessiz, duraklatılmış).
class VideoThumb extends StatefulWidget {
  const VideoThumb({
    super.key,
    required this.path,
    required this.kind,
  });

  final String? path;
  final MediaKind kind;

  @override
  State<VideoThumb> createState() => _VideoThumbState();
}

class _VideoThumbState extends State<VideoThumb> {
  VideoPlayerController? _controller;
  var _loading = true;

  @override
  void initState() {
    super.initState();
    _open();
  }

  @override
  void didUpdateWidget(covariant VideoThumb oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.path != widget.path) {
      _disposeController();
      _loading = true;
      _open();
    }
  }

  Future<void> _open() async {
    final path = widget.path;
    if (kIsWeb || path == null || path.isEmpty) {
      if (mounted) setState(() => _loading = false);
      return;
    }
    final controller = await openVideoFileController(path);
    if (controller == null) {
      if (mounted) setState(() => _loading = false);
      return;
    }
    try {
      await controller.initialize();
      await controller.setVolume(0);
      await controller.pause();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() {
        _controller = controller;
        _loading = false;
      });
    } catch (_) {
      await controller.dispose();
      if (mounted) setState(() => _loading = false);
    }
  }

  void _disposeController() {
    final c = _controller;
    _controller = null;
    c?.dispose();
  }

  @override
  void dispose() {
    _disposeController();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = _controller;
    if (c != null && c.value.isInitialized) {
      final size = c.value.size;
      return Stack(
        fit: StackFit.expand,
        children: [
          ColoredBox(
            color: Colors.black,
            child: FittedBox(
              fit: BoxFit.cover,
              clipBehavior: Clip.hardEdge,
              child: SizedBox(
                width: size.width == 0 ? 16 : size.width,
                height: size.height == 0 ? 9 : size.height,
                child: VideoPlayer(c),
              ),
            ),
          ),
          const Align(
            alignment: Alignment.bottomRight,
            child: Padding(
              padding: EdgeInsets.all(4),
              child: Icon(Icons.play_circle_fill, size: 22, color: Colors.white70),
            ),
          ),
        ],
      );
    }
    return ColoredBox(
      color: Colors.black26,
      child: Center(
        child: _loading
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : Icon(kindVideoIcon(widget.kind)),
      ),
    );
  }
}

/// Tam ekran görüntüleyici için oynatılabilir video.
class VideoPlaybackPane extends StatefulWidget {
  const VideoPlaybackPane({
    super.key,
    required this.path,
    required this.name,
    required this.kind,
    this.posterBytes,
    this.preferExternal = false,
  });

  final String? path;
  final String name;
  final MediaKind kind;
  final Uint8List? posterBytes;
  /// Windows’ta HEVC (GoPro/DJI) için önce sistem oynatıcı.
  final bool preferExternal;

  @override
  State<VideoPlaybackPane> createState() => _VideoPlaybackPaneState();
}

class _VideoPlaybackPaneState extends State<VideoPlaybackPane> {
  VideoPlayerController? _controller;
  String? _status;
  var _loading = true;
  var _openedExternal = false;

  bool get _windowsExternalFirst =>
      widget.preferExternal && hostIsWindows;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void didUpdateWidget(covariant VideoPlaybackPane oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.path != widget.path) {
      _disposeController();
      _status = null;
      _loading = true;
      _openedExternal = false;
      _start();
    }
  }

  Future<void> _start() async {
    if (_windowsExternalFirst) {
      await _openExternally();
      if (mounted) {
        setState(() {
          _loading = false;
          _status = _openedExternal
              ? 'Windows oynatıcısında açıldı.'
              : 'Windows oynatıcısı açılamadı.';
        });
      }
      return;
    }
    await _openInApp();
  }

  Future<void> _openInApp() async {
    final path = widget.path;
    if (kIsWeb || path == null || path.isEmpty) {
      if (mounted) {
        setState(() {
          _loading = false;
          _status = 'Yerel dosya yolu yok.';
        });
      }
      return;
    }
    final controller = await openVideoFileController(path);
    if (controller == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _status = 'Dosya bulunamadı:\n$path';
        });
      }
      return;
    }

    try {
      await controller.initialize();
      await controller.setLooping(true);
      if (!mounted) {
        await controller.dispose();
        return;
      }
      controller.addListener(() {
        if (mounted) setState(() {});
      });
      setState(() {
        _controller = controller;
        _loading = false;
        _status = null;
      });
      await controller.play();
    } catch (_) {
      await controller.dispose();
      // Codec (HEVC vb.) uygulama içinde yoksa telefon/sistem oynatıcısına düş.
      await _openExternally();
      if (mounted) {
        setState(() {
          _loading = false;
          _status = _openedExternal
              ? (hostIsAndroid
                  ? 'Telefon oynatıcısında açıldı.'
                  : 'Sistem oynatıcısında açıldı.')
              : 'Video açılamadı.';
        });
      }
    }
  }

  void _disposeController() {
    final c = _controller;
    _controller = null;
    c?.dispose();
  }

  @override
  void dispose() {
    _disposeController();
    super.dispose();
  }

  void _toggle() {
    final c = _controller;
    if (c == null || !c.value.isInitialized) return;
    if (c.value.isPlaying) {
      c.pause();
    } else {
      c.play();
    }
    setState(() {});
  }

  Future<void> _openExternally() async {
    final path = widget.path;
    if (path == null || path.isEmpty) return;
    try {
      if (hostIsWindows) {
        await openPathWithWindowsShell(path);
      } else {
        await OpenFilex.open(path);
      }
      _openedExternal = true;
      if (mounted) setState(() {});
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final poster = widget.posterBytes;
    if (_loading && poster == null) {
      return const Center(child: CircularProgressIndicator());
    }
    final c = _controller;
    if (c != null && c.value.isInitialized) {
      final size = c.value.size;
      return Column(
        children: [
          Expanded(
            child: GestureDetector(
              onTap: _toggle,
              child: Center(
                child: AspectRatio(
                  aspectRatio: c.value.aspectRatio == 0
                      ? (size.width > 0 && size.height > 0
                          ? size.width / size.height
                          : 16 / 9)
                      : c.value.aspectRatio,
                  child: Stack(
                    alignment: Alignment.center,
                    fit: StackFit.expand,
                    children: [
                      if (poster != null)
                        OrientedMemoryImage(poster, fit: BoxFit.contain),
                      VideoPlayer(c),
                      if (!c.value.isPlaying)
                        const Icon(
                          Icons.play_circle_fill,
                          size: 64,
                          color: Colors.white70,
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          VideoProgressIndicator(
            c,
            allowScrubbing: true,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
            child: Row(
              children: [
                IconButton(
                  tooltip: c.value.isPlaying ? 'Duraklat' : 'Oynat',
                  onPressed: _toggle,
                  icon: Icon(
                    c.value.isPlaying ? Icons.pause : Icons.play_arrow,
                  ),
                ),
                Expanded(
                  child: Text(
                    widget.name,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white70),
                  ),
                ),
                IconButton(
                  tooltip: _externalReopenLabel(),
                  onPressed: _openExternally,
                  icon: const Icon(Icons.open_in_new),
                ),
              ],
            ),
          ),
        ],
      );
    }

    // Uygulama içi oynatılamadı — dış oynatıcı zaten otomatik açıldı.
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (poster != null) ...[
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 360),
                child: OrientedMemoryImage(poster, fit: BoxFit.contain),
              ),
              const SizedBox(height: 16),
            ] else if (_loading)
              const CircularProgressIndicator()
            else
              Icon(kindVideoIcon(widget.kind), size: 56, color: Colors.white70),
            Text(
              widget.name,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white),
            ),
            if (_status != null) ...[
              const SizedBox(height: 8),
              Text(
                _status!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white54),
              ),
            ],
            if (_openedExternal || _windowsExternalFirst) ...[
              const SizedBox(height: 16),
              TextButton.icon(
                onPressed: _openExternally,
                icon: const Icon(Icons.refresh),
                label: Text(_externalReopenLabel()),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
