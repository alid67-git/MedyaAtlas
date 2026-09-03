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

/// Döndürülebilir 3D dünya — harita katmanına göre doku; medya yuvarlak yığın.
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
  static const _maxPoints = 280;

  late final FlutterEarthGlobeController _controller;
  String _syncKey = '';
  MapLayer? _loadedLayer;
  var _surfaceReady = false;
  var _loadFailed = false;

  FlutterEarthGlobeController get controller => _controller;

  static AssetImage _textureFor(MapLayer layer) => switch (layer) {
        MapLayer.satellite => const AssetImage('assets/globe/earth-day.jpg'),
        MapLayer.streets => const AssetImage('assets/globe/earth-streets.jpg'),
        MapLayer.topo => const AssetImage('assets/globe/earth-day.jpg'),
        MapLayer.dark => const AssetImage('assets/globe/earth-night.jpg'),
      };

  @override
  void initState() {
    super.initState();
    _controller = FlutterEarthGlobeController(
      rotationSpeed: 0.03,
      isRotating: false,
      isZoomEnabled: true,
      zoom: 0.85,
      minZoom: -0.4,
      maxZoom: 3.5,
      atmosphereOpacity: 0.45,
      atmosphereThickness: 0.04,
      surfaceLightingEnabled: true,
      isDayNightCycleEnabled: false,
      showAtmosphere: true,
      sphereStyle: const SphereStyle(
        showShadow: true,
        shadowBlurSigma: 28,
      ),
    );
    _controller.addListener(_onController);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _applyLayerTexture(widget.mapLayer, force: true);
      _syncPoints(force: true);
    });
    // Doku yüklenmezse kullanıcı boş ekranda kalmasın.
    Future<void>.delayed(const Duration(seconds: 6), () {
      if (!mounted || _surfaceReady) return;
      setState(() => _loadFailed = true);
    });
  }

  void _onController() {
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
    if (oldWidget.clusters != widget.clusters ||
        oldWidget.display != widget.display ||
        oldWidget.repo != widget.repo) {
      _syncPoints();
    }
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
    // Precache sonra load — web/android’de boş küre olmasın.
    precacheImage(img, context).then((_) {
      if (!mounted) return;
      _controller.loadSurface(img);
      if (layer == MapLayer.dark) {
        _controller.loadNightSurface(
          const AssetImage('assets/globe/earth-night.jpg'),
        );
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
    var lat = 0.0;
    var lng = 0.0;
    for (final c in pts) {
      lat += c.latitude;
      lng += c.longitude;
    }
    focusLatLng(lat / pts.length, lng / pts.length);
  }

  void _syncPoints({bool force = false}) {
    if (!mounted) return;
    final key = Object.hash(
      widget.clusters.length,
      widget.display.index,
      Object.hashAll([
        for (final c in widget.clusters.take(40))
          Object.hash(c.id, c.items.length),
      ]),
    ).toString();
    if (!force && key == _syncKey && _controller.points.isNotEmpty) return;
    _syncKey = key;

    final existing = List<Point>.from(_controller.points);
    for (final p in existing) {
      _controller.removePoint(p.id);
    }

    final ranked = List<LocationCluster>.from(widget.clusters)
      ..sort((a, b) => b.items.length.compareTo(a.items.length));

    for (final cluster in ranked.take(_maxPoints)) {
      final lat = cluster.latitude;
      final lng = cluster.longitude;
      if (!lat.isFinite || !lng.isFinite) continue;
      if (lat.abs() > 90 || lng.abs() > 180) continue;
      final n = cluster.items.length;
      final photos = widget.display == MapPinDisplay.photos;
      final covers = photos ? clusterPinCovers(cluster.items) : null;
      _controller.addPoint(
        Point(
          id: cluster.id,
          coordinates: GlobeCoordinates(lat, lng),
          isLabelVisible: photos,
          labelOffset: const Offset(0, -36),
          labelBuilder: photos
              ? (context, point, hovering, visible) {
                  if (!visible || covers == null) {
                    return const SizedBox.shrink();
                  }
                  return Transform.scale(
                    scale: hovering ? 1.1 : 1.0,
                    child: PhotoMapPin(
                      item: covers.cover,
                      repo: widget.repo,
                      count: n,
                      extraCovers: covers.behind,
                      showTip: true,
                    ),
                  );
                }
              : null,
          style: photos
              ? PointStyle(
                  size: 3,
                  color: Colors.white.withValues(alpha: 0.2),
                  altitude: 0.03,
                  transitionDuration: 180,
                  merge: false,
                )
              : PointStyle(
                  size: _heatSize(n),
                  color: _heatColor(n),
                  altitude: 0.05,
                  transitionDuration: 180,
                  merge: true,
                ),
          onTap: () => widget.onOpenCluster(cluster),
        ),
      );
    }
  }

  static double _heatSize(int count) {
    final n = count.clamp(1, 200);
    return math.min(14.0, 4.0 + math.sqrt(n) * 1.6);
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
          final side = math.min(constraints.maxWidth, constraints.maxHeight);
          final radius = (side * 0.40).clamp(140.0, 480.0);
          return Stack(
            fit: StackFit.expand,
            children: [
              Center(
                child: SizedBox(
                  width: constraints.maxWidth,
                  height: constraints.maxHeight,
                  child: FlutterEarthGlobe(
                    controller: _controller,
                    radius: radius,
                    alignment: Alignment.center,
                  ),
                ),
              ),
              if (!_surfaceReady)
                Center(
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
            ],
          );
        },
      ),
    );
  }
}
