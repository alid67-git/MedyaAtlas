import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_earth_globe/flutter_earth_globe.dart';
import 'package:flutter_earth_globe/flutter_earth_globe_controller.dart';
import 'package:flutter_earth_globe/globe_coordinates.dart';
import 'package:flutter_earth_globe/point.dart';

import '../models/library_media.dart';
import '../repositories/media_repository.dart';
import '../services/app_settings.dart';
import '../services/media_groups.dart';
import 'photo_map_pin.dart';

/// Döndürülebilir 3D dünya — küme medyaları nokta / foto etiket olarak.
class MediaGlobeView extends StatefulWidget {
  const MediaGlobeView({
    super.key,
    required this.clusters,
    required this.repo,
    required this.display,
    required this.shape,
    required this.onOpenCluster,
  });

  final List<LocationCluster> clusters;
  final MediaRepository repo;
  final MapPinDisplay display;
  final MapPinShape shape;
  final ValueChanged<LocationCluster> onOpenCluster;

  @override
  State<MediaGlobeView> createState() => MediaGlobeViewState();
}

class MediaGlobeViewState extends State<MediaGlobeView> {
  static const _maxPoints = 280;

  late final FlutterEarthGlobeController _controller;
  String _syncKey = '';

  FlutterEarthGlobeController get controller => _controller;

  @override
  void initState() {
    super.initState();
    _controller = FlutterEarthGlobeController(
      rotationSpeed: 0.04,
      isRotating: false,
      isZoomEnabled: true,
      zoom: 0.35,
      minZoom: -0.8,
      maxZoom: 3.2,
      atmosphereOpacity: 0.55,
      surfaceLightingEnabled: true,
      isDayNightCycleEnabled: false,
      surface: const AssetImage('assets/globe/earth-day.jpg'),
    );
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncPoints());
  }

  @override
  void didUpdateWidget(covariant MediaGlobeView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.clusters != widget.clusters ||
        oldWidget.display != widget.display ||
        oldWidget.shape != widget.shape ||
        oldWidget.repo != widget.repo) {
      _syncPoints();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
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

  void _syncPoints() {
    if (!mounted) return;
    final key = Object.hash(
      widget.clusters.length,
      widget.display.index,
      widget.shape.index,
      Object.hashAll([
        for (final c in widget.clusters.take(40))
          Object.hash(c.id, c.items.length),
      ]),
    ).toString();
    if (key == _syncKey && _controller.points.isNotEmpty) return;
    _syncKey = key;

    final existing = List<Point>.from(_controller.points);
    for (final p in existing) {
      _controller.removePoint(p.id);
    }

    final ranked = List<LocationCluster>.from(widget.clusters)
      ..sort((a, b) => b.items.length.compareTo(a.items.length));
    final take = ranked.take(_maxPoints);

    for (final cluster in take) {
      final lat = cluster.latitude;
      final lng = cluster.longitude;
      if (!lat.isFinite || !lng.isFinite) continue;
      if (lat.abs() > 90 || lng.abs() > 180) continue;
      final n = cluster.items.length;
      final photos = widget.display == MapPinDisplay.photos;
      _controller.addPoint(
        Point(
          id: cluster.id,
          coordinates: GlobeCoordinates(lat, lng),
          isLabelVisible: photos,
          labelOffset: const Offset(0, -28),
          labelBuilder: photos
              ? (context, point, hovering, visible) {
                  if (!visible) return const SizedBox.shrink();
                  return _GlobePhotoLabel(
                    item: coverMediaOf(cluster.items),
                    repo: widget.repo,
                    count: n,
                    shape: widget.shape,
                    highlight: hovering,
                  );
                }
              : null,
          style: photos
              ? PointStyle(
                  size: 2,
                  color: Colors.white.withValues(alpha: 0.15),
                  altitude: 0.02,
                  transitionDuration: 200,
                  merge: false,
                )
              : PointStyle(
                  size: _heatSize(n),
                  color: _heatColor(n),
                  altitude: 0.04,
                  transitionDuration: 200,
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
    final heat = math.min(1.0, math.log(count.clamp(1, 500) + 1) / math.log(40));
    return Color.lerp(
      const Color(0xFF40A0FF),
      const Color(0xFFF5E64A),
      heat,
    )!;
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final radius = math.min(size.width, size.height) * 0.42;
    return ColoredBox(
      color: const Color(0xFF050B12),
      child: Center(
        child: FlutterEarthGlobe(
          controller: _controller,
          radius: radius.clamp(120.0, 420.0),
          alignment: Alignment.center,
        ),
      ),
    );
  }
}

class _GlobePhotoLabel extends StatelessWidget {
  const _GlobePhotoLabel({
    required this.item,
    required this.repo,
    required this.count,
    required this.shape,
    required this.highlight,
  });

  final LibraryMedia item;
  final MediaRepository repo;
  final int count;
  final MapPinShape shape;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    return Transform.scale(
      scale: highlight ? 1.08 : 1.0,
      child: PhotoMapPin(
        item: item,
        repo: repo,
        count: count,
        shape: shape,
      ),
    );
  }
}
