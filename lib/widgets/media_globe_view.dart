import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_earth_globe/flutter_earth_globe.dart';
import 'package:flutter_earth_globe/flutter_earth_globe_controller.dart';
import 'package:flutter_earth_globe/globe_coordinates.dart';
import 'package:flutter_earth_globe/point.dart';
import 'package:flutter_earth_globe/sphere_style.dart';

import '../models/library_media.dart';
import '../repositories/media_repository.dart';
import '../services/app_settings.dart';
import 'photo_map_pin.dart';

/// Döndürülebilir 3D dünya — sabit yarıçap; dokununca layout/etiket patlamasın.
class MediaGlobeView extends StatefulWidget {
  const MediaGlobeView({
    super.key,
    required this.clusters,
    required this.repo,
    required this.display,
    required this.mapLayer,
    required this.onOpenCluster,
  });

  final List<LocationCluster> clusters;
  final MediaRepository repo;
  final MapPinDisplay display;
  final MapLayer mapLayer;
  final ValueChanged<LocationCluster> onOpenCluster;

  @override
  State<MediaGlobeView> createState() => MediaGlobeViewState();
}

class MediaGlobeViewState extends State<MediaGlobeView> {
  /// Nokta sayısı (ısı); etiketler ayrıca sınırlı.
  static const _maxPoints = 120;
  /// Ağır foto etiketleri — yalnızca en büyük kümeler.
  static const _maxPhotoLabels = 16;

  late final FlutterEarthGlobeController _controller;
  String _syncKey = '';
  MapLayer? _loadedLayer;
  var _surfaceReady = false;
  var _loadFailed = false;
  var _didFocus = false;

  /// İlk layout’ta kilitlenir — şerit/panel açılınca radius değişmesin.
  double? _lockedRadius;
  var _syncingPoints = false;

  FlutterEarthGlobeController get controller => _controller;

  /// 4K sokak dokusu GPU’yu kilitliyor; küre için 2K yeterli.
  static ImageProvider _textureFor(MapLayer layer) {
    final asset = switch (layer) {
      MapLayer.satellite => const AssetImage('assets/globe/earth-day.jpg'),
      MapLayer.streets => const AssetImage('assets/globe/earth-streets.jpg'),
      MapLayer.topo => const AssetImage('assets/globe/earth-day.jpg'),
      MapLayer.dark => const AssetImage('assets/globe/earth-night.jpg'),
    };
    return ResizeImage(asset, width: 2048, height: 1024);
  }

  @override
  void initState() {
    super.initState();
    _controller = FlutterEarthGlobeController(
      rotationSpeed: 0.05,
      isRotating: false,
      isZoomEnabled: true,
      // convertedRadius = radius * 2^zoom — aşırı zoom layout’u şişirir.
      zoom: 0.55,
      minZoom: 0.2,
      maxZoom: 1.15,
      zoomSensitivity: 0.7,
      panSensitivity: 1.55,
      zoomToMousePosition: false,
      atmosphereOpacity: 0.28,
      atmosphereThickness: 0.028,
      surfaceLightingEnabled: false,
      isDayNightCycleEnabled: false,
      showAtmosphere: true,
      sphereStyle: const SphereStyle(
        showShadow: true,
        shadowBlurSigma: 12,
      ),
    );
    _controller.addListener(_onController);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _applyLayerTexture(widget.mapLayer, force: true);
      _syncPoints(force: true);
    });
    Future<void>.delayed(const Duration(seconds: 8), () {
      if (!mounted || _surfaceReady) return;
      setState(() => _loadFailed = true);
    });
  }

  void _onController() {
    if (_syncingPoints) return;
    final ready = _controller.surface != null;
    if (ready != _surfaceReady && mounted) {
      setState(() {
        _surfaceReady = ready;
        if (ready) _loadFailed = false;
      });
    }
  }

  @override
  void didUpdateWidget(covariant MediaGlobeView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.mapLayer != widget.mapLayer) {
      _applyLayerTexture(widget.mapLayer, force: true);
    }
    if (oldWidget.display != widget.display ||
        oldWidget.repo != widget.repo ||
        !_sameClusterSet(oldWidget.clusters, widget.clusters)) {
      _syncPoints();
    }
  }

  bool _sameClusterSet(List<LocationCluster> a, List<LocationCluster> b) {
    if (identical(a, b)) return true;
    if (a.length != b.length) return false;
    // Kısa imza — dokununca parent rebuild’inde gereksiz sync olmasın.
    if (a.isEmpty) return true;
    return a.first.id == b.first.id &&
        a.last.id == b.last.id &&
        a.length == b.length;
  }

  @override
  void dispose() {
    _controller.removeListener(_onController);
    _controller.dispose();
    super.dispose();
  }

  void _applyLayerTexture(MapLayer layer, {bool force = false}) {
    if (!force && _loadedLayer == layer) return;
    _loadedLayer = layer;
    final img = _textureFor(layer);
    precacheImage(img, context).then((_) {
      if (!mounted) return;
      _controller.loadSurface(img);
      if (layer == MapLayer.dark) {
        _controller.loadNightSurface(_textureFor(MapLayer.dark));
      }
    }).catchError((_) {
      if (!mounted) return;
      _controller.loadSurface(img);
    });
  }

  void focusLatLng(double lat, double lng, {bool animate = true}) {
    if (!lat.isFinite || !lng.isFinite) return;
    try {
      _controller.focusOnCoordinates(
        GlobeCoordinates(lat, lng),
        animate: animate,
      );
    } catch (_) {}
  }

  void fitClusters() {
    final pts = [
      for (final c in widget.clusters)
        if (c.latitude.isFinite && c.longitude.isFinite) c,
    ];
    if (pts.isEmpty) return;
    // En çok medyası olan kümeye bak — ortalama (0,0) Afrika’ya düşmesin.
    var best = pts.first;
    for (final c in pts) {
      if (c.items.length > best.items.length) best = c;
    }
    focusLatLng(best.latitude, best.longitude, animate: false);
  }

  void _syncPoints({bool force = false}) {
    if (!mounted) return;
    final key = Object.hash(
      widget.clusters.length,
      widget.display.index,
      Object.hashAll([
        for (final c in widget.clusters.take(24))
          Object.hash(c.id, c.items.length),
      ]),
    ).toString();
    if (!force && key == _syncKey && _controller.points.isNotEmpty) return;
    _syncKey = key;

    _syncingPoints = true;
    try {
      // Toplu temizle — her removePoint notifyListener yapmasın diye doğrudan liste.
      _controller.points.clear();

      final ranked = List<LocationCluster>.from(widget.clusters)
        ..sort((a, b) => b.items.length.compareTo(a.items.length));
      final take = ranked.take(_maxPoints).toList();
      final photos = widget.display == MapPinDisplay.photos;
      final labelIds = photos
          ? {for (final c in take.take(_maxPhotoLabels)) c.id}
          : <String>{};

      for (final cluster in take) {
        final lat = cluster.latitude;
        final lng = cluster.longitude;
        if (!lat.isFinite || !lng.isFinite) continue;
        if (lat.abs() > 90 || lng.abs() > 180) continue;
        final n = cluster.items.length;
        final showLabel = labelIds.contains(cluster.id);
        final covers = showLabel ? clusterPinCovers(cluster.items) : null;
        _controller.points.add(
          Point(
            id: cluster.id,
            coordinates: GlobeCoordinates(lat, lng),
            isLabelVisible: showLabel,
            // Paket: top = pos.dy - labelOffset.dy - height.
            // Negatif dy etiketi güneye iter (Avrupa pinleri Afrika’da görünür).
            labelOffset: Offset.zero,
            labelBuilder: showLabel && covers != null
                ? (context, point, hovering, visible) {
                    if (!visible) return const SizedBox.shrink();
                    return PhotoMapPin(
                      item: covers.cover,
                      repo: widget.repo,
                      count: n,
                      extraCovers: const [],
                      showTip: true,
                    );
                  }
                : null,
            style: photos
                ? PointStyle(
                    size: showLabel ? 2.5 : _heatSize(n).clamp(3, 8),
                    color: showLabel
                        ? Colors.white.withValues(alpha: 0.15)
                        : _heatColor(n),
                    altitude: 0.03,
                    transitionDuration: 0,
                    merge: !showLabel,
                  )
                : PointStyle(
                    size: _heatSize(n),
                    color: _heatColor(n),
                    altitude: 0.04,
                    transitionDuration: 0,
                    merge: true,
                  ),
            onTap: () => widget.onOpenCluster(cluster),
          ),
        );
      }
    } finally {
      _syncingPoints = false;
    }
    // Tek bildirim — küre bir kez yenilensin (paket API’sinde toplu sync yok).
    // ignore: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member
    _controller.notifyListeners();
    if (!_didFocus && _controller.points.isNotEmpty) {
      _didFocus = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) fitClusters();
      });
    }
  }

  static double _heatSize(int count) {
    final n = count.clamp(1, 200);
    return math.min(12.0, 3.5 + math.sqrt(n) * 1.4);
  }

  static Color _heatColor(int count) {
    final heat =
        math.min(1.0, math.log(count.clamp(1, 500) + 1) / math.log(40));
    return Color.lerp(
      const Color(0xFF40A0FF),
      const Color(0xFFF5E64A),
      heat,
    )!;
  }

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: const Color(0xFF050B12),
      child: LayoutBuilder(
        builder: (context, constraints) {
          // İlk çerçevede kilitle — şerit/panel açılınca radius yeniden hesaplanmasın.
          final mq = MediaQuery.sizeOf(context);
          final side = math.min(mq.width, mq.height);
          _lockedRadius ??= (side * 0.34).clamp(140.0, 280.0);
          final radius = _lockedRadius!;
          final w = constraints.maxWidth.isFinite
              ? constraints.maxWidth
              : mq.width;
          final h = constraints.maxHeight.isFinite
              ? constraints.maxHeight
              : mq.height;

          return Stack(
            fit: StackFit.expand,
            children: [
              // Taşmayı kes — paket zoom’da maxWidth’i şişirir.
              ClipRect(
                child: SizedBox(
                  width: w,
                  height: h,
                  child: FlutterEarthGlobe(
                    controller: _controller,
                    radius: radius,
                    alignment: Alignment.center,
                  ),
                ),
              ),
              if (!_surfaceReady)
                IgnorePointer(
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (!_loadFailed) ...[
                          const CircularProgressIndicator(
                            color: Color(0xFF2EC4B6),
                          ),
                          const SizedBox(height: 12),
                          Text(
                            '3D dünya yükleniyor…',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.75),
                            ),
                          ),
                        ] else ...[
                          const Icon(Icons.public_off,
                              color: Colors.white54, size: 40),
                          const SizedBox(height: 8),
                          Text(
                            'Dünya dokusu yüklenemedi.\nHarita türünü değiştirip yeniden deneyin.',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.7),
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextButton(
                            onPressed: () {
                              setState(() {
                                _loadFailed = false;
                                _surfaceReady = false;
                              });
                              _applyLayerTexture(widget.mapLayer, force: true);
                            },
                            child: const Text('Yeniden dene'),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
