import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:uuid/uuid.dart';

import '../models/library_media.dart';
import '../services/geo.dart';
import '../services/volume_mount.dart';

const _indexBoxName = 'medyaatlas_media';
const _bytesBoxName = 'medyaatlas_media_bytes';
const _sourcesBoxName = 'medyaatlas_sources';
const _indexKey = 'index';
const gallerySourceId = 'gallery';

/// Bu cihazdaki kütüphane. RideAtlas gibi: küçük JSON indeks + ayrı kutuda
/// fotoğraf baytları. Video Hive’a yazılmaz; varsa [LibraryMedia.localPath].
class MediaRepository extends ChangeNotifier {
  MediaRepository._();
  static final MediaRepository instance = MediaRepository._();

  final List<LibraryMedia> _items = [];
  final List<MediaSource> _sources = [];
  final Map<String, Uint8List> _bytesCache = {};
  /// Kaynak id → kök şu an erişilebilir mi (harici disk).
  final Map<String, bool> _mountBySource = {};
  Box<String>? _indexBox;
  Box<Uint8List>? _bytesBox;
  Box<String>? _sourcesBox;
  bool _ready = false;

  bool get isReady => _ready;

  Future<void> init() async {
    if (_ready) return;
    _indexBox = await Hive.openBox<String>(_indexBoxName);
    _bytesBox = await Hive.openBox<Uint8List>(_bytesBoxName);
    _sourcesBox = await Hive.openBox<String>(_sourcesBoxName);
    try {
      final raw = _indexBox!.get(_indexKey);
      final list = raw == null ? const [] : jsonDecode(raw) as List<dynamic>;
      _items
        ..clear()
        ..addAll(
          list.map(
            (e) => LibraryMedia.fromJson(Map<String, dynamic>.from(e as Map)),
          ),
        );
    } catch (e) {
      debugPrint('MedyaAtlas: medya indeksi okunamadı, sıfırlanıyor: $e');
      _items.clear();
      await _indexBox!.delete(_indexKey);
    }
    try {
      final srcRaw = _sourcesBox!.get(_indexKey);
      final srcList =
          srcRaw == null ? const [] : jsonDecode(srcRaw) as List<dynamic>;
      _sources
        ..clear()
        ..addAll(
          srcList.map(
            (e) => MediaSource.fromJson(Map<String, dynamic>.from(e as Map)),
          ),
        );
    } catch (e) {
      debugPrint('MedyaAtlas: kaynak indeksi okunamadı, sıfırlanıyor: $e');
      _sources.clear();
      await _sourcesBox!.delete(_indexKey);
    }
    _sanitizeLoadedGps();
    final sourceCount = _sources.length;
    _ensureOrphanSources();
    if (_sources.length != sourceCount) {
      await _persistSources();
    }
    refreshMountStates(notify: false);
    _ready = true;
    notifyListeners();
  }

  /// Eski kayıtlardaki NaN/Infinity GPS → jsonEncode ve harita çökmesin.
  int _stripInvalidGpsInMemory() {
    var changed = 0;
    for (var i = 0; i < _items.length; i++) {
      final item = _items[i];
      if (item.lat == null && item.lng == null) continue;
      if (isValidGps(item.lat, item.lng)) continue;
      _items[i] = item.copyWith(clearLocation: true, locationMissing: true);
      changed++;
    }
    return changed;
  }

  void _sanitizeLoadedGps() {
    if (_stripInvalidGpsInMemory() > 0) {
      unawaited(_persistIndex());
    }
  }

  /// jsonEncode NaN/Infinity kabul etmez — ağaçtaki bozuk sayıları temizle.
  void _scrubNonFinite(Object? node) {
    if (node is Map) {
      final keys = List<Object?>.from(node.keys);
      for (final key in keys) {
        final value = node[key];
        if (value is double && !value.isFinite) {
          node[key] = null;
        } else {
          _scrubNonFinite(value);
        }
      }
    } else if (node is List) {
      for (var i = 0; i < node.length; i++) {
        final value = node[i];
        if (value is double && !value.isFinite) {
          node[i] = null;
        } else {
          _scrubNonFinite(value);
        }
      }
    }
  }

  void _ensureOrphanSources() {
    final known = _sources.map((s) => s.id).toSet();
    final missing = <String, DateTime>{};
    for (final item in _items) {
      if (known.contains(item.sourceId)) continue;
      final prev = missing[item.sourceId];
      if (prev == null || item.addedAt.isBefore(prev)) {
        missing[item.sourceId] = item.addedAt;
      }
    }
    if (missing.isEmpty) return;
    for (final entry in missing.entries) {
      _sources.add(
        MediaSource(
          id: entry.key,
          label: entry.key == gallerySourceId ? 'Galeri' : 'Kaynak',
          addedAt: entry.value,
        ),
      );
    }
  }

  List<LibraryMedia> get items => List.unmodifiable(_items);
  List<MediaSource> get sources => List.unmodifiable(_sources);

  Set<String> get hiddenSourceIds =>
      _sources.where((s) => s.hidden).map((s) => s.id).toSet();

  /// Gizli veya (harici) kökü bağlı olmayan kaynaklar.
  Set<String> get unavailableSourceIds {
    final out = <String>{};
    for (final s in _sources) {
      if (s.hidden || !isSourceMounted(s)) out.add(s.id);
    }
    return out;
  }

  bool isSourceMounted(MediaSource source) {
    if (!source.isRemovableVolume) return true;
    final cached = _mountBySource[source.id];
    if (cached != null) return cached;
    final ok = rootPathExists(source.rootPath!);
    _mountBySource[source.id] = ok;
    return ok;
  }

  /// Harici disk tak/çıkar — değişince haritayı yenile.
  bool refreshMountStates({bool notify = true}) {
    var changed = false;
    for (final s in _sources) {
      if (!s.isRemovableVolume) {
        if (_mountBySource.remove(s.id) != null) changed = true;
        continue;
      }
      final ok = rootPathExists(s.rootPath!);
      if (_mountBySource[s.id] != ok) {
        _mountBySource[s.id] = ok;
        changed = true;
      }
    }
    if (changed && notify) notifyListeners();
    return changed;
  }

  List<LibraryMedia> get visibleItems => _items
      .where((m) => !unavailableSourceIds.contains(m.sourceId))
      .toList();

  List<LibraryMedia> get withLocation =>
      visibleItems.where((m) => m.hasLocation).toList();

  List<LibraryMedia> get locationMissing =>
      visibleItems.where((m) => !m.hasLocation).toList();

  MediaSource? sourceOf(String id) {
    for (final s in _sources) {
      if (s.id == id) return s;
    }
    return null;
  }

  Uint8List? cachedBytes(String id) => _bytesCache[id];

  Future<Uint8List?> bytesOf(String id) async {
    final cached = _bytesCache[id];
    if (cached != null) return cached;
    final bytes = _bytesBox?.get(id);
    if (bytes != null) _bytesCache[id] = bytes;
    return bytes;
  }

  Future<void> _persistIndex() async {
    _stripInvalidGpsInMemory();
    try {
      final payload = <Map<String, dynamic>>[
        for (final m in _items) m.toJson(),
      ];
      _scrubNonFinite(payload);
      await _indexBox!.put(_indexKey, jsonEncode(payload));
    } catch (e, st) {
      // Tarama / harita ayakta kalsın — NaN yüzünden tüm klasör düşmesin.
      debugPrint('MedyaAtlas: medya indeksi yazılamadı: $e\n$st');
    }
  }

  Future<void> _persistSources() async {
    try {
      await _sourcesBox!.put(
        _indexKey,
        jsonEncode(_sources.map((s) => s.toJson()).toList()),
      );
    } catch (e, st) {
      debugPrint('MedyaAtlas: kaynak indeksi yazılamadı: $e\n$st');
    }
  }

  Future<MediaSource> ensureSource({
    String? id,
    required String label,
    String? rootPath,
  }) async {
    final normalizedRoot =
        rootPath == null || rootPath.trim().isEmpty
            ? null
            : normalizeRootPath(rootPath);

    if (normalizedRoot != null) {
      for (final s in _sources) {
        if (s.rootPath == null) continue;
        if (normalizeRootPath(s.rootPath!) == normalizedRoot) {
          if (s.label != label) {
            final i = _sources.indexWhere((x) => x.id == s.id);
            _sources[i] = s.copyWith(label: label, rootPath: normalizedRoot);
            await _persistSources();
            refreshMountStates(notify: false);
            notifyListeners();
            return _sources[i];
          }
          return s;
        }
      }
    }

    if (id != null) {
      for (final s in _sources) {
        if (s.id == id) {
          if (normalizedRoot != null && s.rootPath != normalizedRoot) {
            final i = _sources.indexWhere((x) => x.id == s.id);
            _sources[i] = s.copyWith(rootPath: normalizedRoot, label: label);
            await _persistSources();
            refreshMountStates(notify: false);
            notifyListeners();
            return _sources[i];
          }
          return s;
        }
      }
    }

    // Kök yolu olmayan kaynaklarda etiket eşleşmesi (Galeri vb.).
    if (normalizedRoot == null) {
      for (final s in _sources) {
        if (s.label == label && s.rootPath == null) return s;
      }
    }

    final source = MediaSource(
      id: id ?? const Uuid().v4(),
      label: label,
      addedAt: DateTime.now(),
      rootPath: normalizedRoot,
    );
    _sources.add(source);
    await _persistSources();
    refreshMountStates(notify: false);
    notifyListeners();
    return source;
  }

  Future<void> setSourceHidden(String id, bool hidden) async {
    final i = _sources.indexWhere((s) => s.id == id);
    if (i < 0) return;
    _sources[i] = _sources[i].copyWith(hidden: hidden);
    await _persistSources();
    notifyListeners();
  }

  Future<void> removeSource(String id) async {
    final ids = _items.where((m) => m.sourceId == id).map((m) => m.id).toList();
    _items.removeWhere((m) => m.sourceId == id);
    _sources.removeWhere((s) => s.id == id);
    _mountBySource.remove(id);
    for (final mediaId in ids) {
      _bytesCache.remove(mediaId);
      await _bytesBox?.delete(mediaId);
    }
    await _persistIndex();
    await _persistSources();
    notifyListeners();
  }

  LibraryMedia? findByIndex({
    required String sourceId,
    required String relativePath,
    required int size,
  }) {
    final id = mediaIndexId(
      sourceId: sourceId,
      relativePath: relativePath,
      size: size,
    );
    for (final item in _items) {
      if (item.id == id) return item;
    }
    return null;
  }

  Future<LibraryMedia> add({
    required String name,
    required MediaKind kind,
    required String sourceId,
    Uint8List? bytes,
    String? relativePath,
    String? localPath,
    int? sizeBytes,
    double? lat,
    double? lng,
    DateTime? takenAt,
    bool persist = true,
    bool notify = true,
  }) async {
    final rel = relativePath ?? name;
    final size = sizeBytes ?? 0;
    final id = mediaIndexId(sourceId: sourceId, relativePath: rel, size: size);
    final existing = _items.indexWhere((m) => m.id == id);
    if (existing >= 0) {
      return _items[existing];
    }
    final hasGps = isValidGps(lat, lng);
    final media = LibraryMedia(
      id: id,
      name: name,
      addedAt: DateTime.now(),
      kind: kind,
      sourceId: sourceId,
      relativePath: rel,
      lat: hasGps ? lat : null,
      lng: hasGps ? lng : null,
      takenAt: takenAt,
      locationMissing: !hasGps,
      localPath: localPath,
      sizeBytes: sizeBytes,
    );
    _items.insert(0, media);
    if (bytes != null && bytes.isNotEmpty) {
      await _bytesBox!.put(media.id, bytes);
      _bytesCache[media.id] = bytes;
    }
    if (persist) {
      await _persistIndex();
    }
    if (notify) {
      notifyListeners();
    }
    return media;
  }

  /// Tarama / sonradan çıkarılan video önizleme JPEG’i.
  Future<void> putPreviewBytes(String id, Uint8List bytes) async {
    if (bytes.isEmpty) return;
    await _bytesBox!.put(id, bytes);
    _bytesCache[id] = bytes;
  }

  Future<void> updateLocation({
    required String id,
    double? lat,
    double? lng,
    DateTime? takenAt,
    bool persist = true,
    bool notify = true,
  }) async {
    final i = _items.indexWhere((m) => m.id == id);
    if (i < 0) return;
    final hasGps = isValidGps(lat, lng);
    _items[i] = hasGps
        ? _items[i].copyWith(
            lat: lat,
            lng: lng,
            takenAt: takenAt,
            locationMissing: false,
          )
        : _items[i].copyWith(
            clearLocation: true,
            takenAt: takenAt,
            locationMissing: true,
          );
    if (persist) {
      await _persistIndex();
    }
    if (notify) {
      notifyListeners();
    }
  }

  Future<void> flush({bool notify = true}) async {
    await _persistIndex();
    if (notify) notifyListeners();
  }

  Future<void> remove(String id) async {
    _items.removeWhere((m) => m.id == id);
    _bytesCache.remove(id);
    await _persistIndex();
    await _bytesBox?.delete(id);
    notifyListeners();
  }
}
