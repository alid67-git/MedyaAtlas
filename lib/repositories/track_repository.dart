import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';

import '../models/map_track.dart';
import '../services/track_parse.dart';

const _tracksBoxName = 'medyaatlas_tracks';
const _tracksKey = 'tracks';

/// GPX / KML / KMZ izleri — Hive indeks (dosya kopyası yok).
class TrackRepository extends ChangeNotifier {
  TrackRepository._();
  static final TrackRepository instance = TrackRepository._();

  final List<MapTrack> _tracks = [];
  List<MapTrack> _visibleTracksCache = const [];
  Box<String>? _box;
  bool _ready = false;

  bool get isReady => _ready;
  List<MapTrack> get tracks => List.unmodifiable(_tracks);
  Iterable<MapTrack> get visibleTracks => _visibleTracksCache;
  /// Aynı liste örneği — pan rebuild’de toList() / yeniden filtre yok.
  List<MapTrack> get visibleTracksList => _visibleTracksCache;

  void _refreshVisibleCache() {
    _visibleTracksCache = [
      for (final t in _tracks)
        if (t.visible) t,
    ];
  }

  /// Rota içi GPX/KML zamanına göre — en yeni üstte.
  void _sortNewestFirst() {
    _tracks.sort(compareTracksNewestFirst);
    _refreshVisibleCache();
  }

  MapTrack _normalizeLoadedTrack(MapTrack track) => finalizeTrack(
        track,
        maxPoints: track.pointCount ?? track.points.length,
      );

  /// Aynı rota daha önce yüklendi mi? (ad + bounds + uç noktalar)
  bool hasEquivalent(MapTrack track) {
    final key = trackContentKey(track);
    for (final t in _tracks) {
      if (trackContentKey(t) == key) return true;
    }
    return false;
  }

  /// Yoksa ekler; varsa false.
  Future<bool> addIfNew(MapTrack track) async {
    if (hasEquivalent(track)) return false;
    await add(track);
    return true;
  }

  Future<void> init() async {
    if (_ready) return;
    _box = await Hive.openBox<String>(_tracksBoxName);
    try {
      final raw = _box!.get(_tracksKey);
      if (raw != null) {
        final list = jsonDecode(raw) as List<dynamic>;
        _tracks
          ..clear()
          ..addAll(
            list.map(
              (e) => _normalizeLoadedTrack(
                MapTrack.fromJson(Map<String, dynamic>.from(e as Map)),
              ),
            ),
          );
        _sortNewestFirst();
        if (_tracks.isNotEmpty) await _persist();
      }
    } catch (e) {
      debugPrint('MedyaAtlas: iz indeksi okunamadı: $e');
      _tracks.clear();
      _refreshVisibleCache();
      await _box!.delete(_tracksKey);
    }
    _ready = true;
    notifyListeners();
  }

  Future<void> _persist() async {
    try {
      await _box!.put(
        _tracksKey,
        jsonEncode(_tracks.map((t) => t.toJson()).toList()),
      );
    } catch (e, st) {
      debugPrint('MedyaAtlas: iz indeksi yazılamadı: $e\n$st');
    }
  }

  Future<void> add(MapTrack track) async {
    final i = _tracks.indexWhere((t) => t.id == track.id);
    if (i >= 0) {
      _tracks[i] = track;
    } else {
      _tracks.add(track);
    }
    _sortNewestFirst();
    await _persist();
    notifyListeners();
  }

  Future<void> addAll(Iterable<MapTrack> tracks) async {
    for (final t in tracks) {
      final i = _tracks.indexWhere((x) => x.id == t.id);
      if (i >= 0) {
        _tracks[i] = t;
      } else {
        _tracks.add(t);
      }
    }
    _sortNewestFirst();
    await _persist();
    notifyListeners();
  }

  Future<void> setVisible(String id, bool visible) async {
    final i = _tracks.indexWhere((t) => t.id == id);
    if (i < 0) return;
    _tracks[i] = _tracks[i].copyWith(visible: visible);
    _refreshVisibleCache();
    await _persist();
    notifyListeners();
  }

  Future<void> setVisibleMany(Iterable<String> ids, bool visible) async {
    final want = ids.toSet();
    var changed = false;
    for (var i = 0; i < _tracks.length; i++) {
      final t = _tracks[i];
      if (!want.contains(t.id) || t.visible == visible) continue;
      _tracks[i] = t.copyWith(visible: visible);
      changed = true;
    }
    if (!changed) return;
    _refreshVisibleCache();
    await _persist();
    notifyListeners();
  }

  /// [ids] null → tüm izler.
  Future<void> setOnlyVisible(Iterable<String>? ids) async {
    final want = ids?.toSet();
    var changed = false;
    for (var i = 0; i < _tracks.length; i++) {
      final t = _tracks[i];
      final next = want == null ? true : want.contains(t.id);
      if (t.visible == next) continue;
      _tracks[i] = t.copyWith(visible: next);
      changed = true;
    }
    if (!changed) return;
    _refreshVisibleCache();
    await _persist();
    notifyListeners();
  }

  Future<void> remove(String id) async {
    _tracks.removeWhere((t) => t.id == id);
    _refreshVisibleCache();
    await _persist();
    notifyListeners();
  }

  Future<void> removeMany(Iterable<String> ids) async {
    final want = ids.toSet();
    final before = _tracks.length;
    _tracks.removeWhere((t) => want.contains(t.id));
    if (_tracks.length == before) return;
    _refreshVisibleCache();
    await _persist();
    notifyListeners();
  }
}
