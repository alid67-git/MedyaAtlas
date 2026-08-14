import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:desktop_drop/desktop_drop.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import 'package:path/path.dart' as p;

import '../app_version.dart';
import '../models/library_media.dart';
import '../repositories/media_repository.dart';
import '../services/cluster.dart';
import '../services/exif_gps.dart';
import '../services/folder_picker.dart';
import '../services/header_gps.dart';
import '../services/place_search.dart';
import '../services/search_text.dart';
import '../widgets/cluster_dot.dart';
import '../widgets/media_viewer.dart';
import '../widgets/photo_source.dart';

const _worldCenter = LatLng(20, 0);

bool get _isDesktop =>
    defaultTargetPlatform == TargetPlatform.windows ||
    defaultTargetPlatform == TargetPlatform.linux ||
    defaultTargetPlatform == TargetPlatform.macOS;

class HomeMapScreen extends StatefulWidget {
  const HomeMapScreen({super.key});

  @override
  State<HomeMapScreen> createState() => _HomeMapScreenState();
}

class _HomeMapScreenState extends State<HomeMapScreen> {
  final _map = MapController();
  final _picker = ImagePicker();
  final _searchCtrl = TextEditingController();
  Timer? _searchDebounce;
  bool _busy = false;
  bool _cancel = false;
  bool _dropping = false;
  bool _sourcesOpen = false;
  String? _kindMenu;
  String? _status;
  bool _showMissing = false;
  String _query = '';
  List<PlaceHit> _places = [];
  LocationCluster? _panelCluster;
  final Set<MediaKind> _kinds = {...MediaKind.values};

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _importGallery() async {
    setState(() {
      _busy = true;
      _cancel = false;
      _status = null;
    });
    try {
      final files = await _picker.pickMultipleMedia();
      if (!mounted || files.isEmpty) return;
      final refs = <FolderMediaRef>[];
      for (final file in files) {
        final size = await file.length();
        refs.add(
          FolderMediaRef(
            name: file.name,
            size: size,
            relativePath: file.name,
            localPath: kIsWeb || file.path.isEmpty ? null : file.path,
            readHead: (maxBytes) async {
              final end = size < maxBytes ? size : maxBytes;
              final builder = BytesBuilder(copy: false);
              await for (final chunk in file.openRead(0, end)) {
                builder.add(chunk);
              }
              return builder.takeBytes();
            },
          ),
        );
      }
      if (!mounted) return;
      final repo = context.read<MediaRepository>();
      final source = await repo.ensureSource(
        id: gallerySourceId,
        label: 'Galeri',
      );
      await _ingest(refs, source: source);
    } catch (e) {
      if (!mounted) return;
      setState(() => _status = 'Galeri açılamadı: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _importFolder() async {
    FolderPickResult? picked;
    try {
      picked = await pickMediaFolder();
    } catch (e) {
      if (!mounted) return;
      setState(() => _status = 'Klasör açılamadı: $e');
      return;
    }
    if (!mounted) return;
    if (picked == null) return;
    await _ingestPick(picked);
  }

  Future<void> _importFiles() async {
    final picked = await FilePicker.platform.pickFiles(
      allowMultiple: true,
      type: FileType.custom,
      allowedExtensions: [...photoExt, ...videoExt],
    );
    if (!mounted || picked == null || picked.files.isEmpty) return;
    final refs = <FolderMediaRef>[];
    for (final file in picked.files) {
      final path = file.path;
      if (path == null) continue;
      refs.add(
        FolderMediaRef(
          name: file.name,
          size: file.size,
          relativePath: file.name,
          localPath: path,
          readHead: (maxBytes) async {
            final io = File(path);
            final n = file.size < maxBytes ? file.size : maxBytes;
            final raf = await io.open();
            try {
              return await raf.read(n);
            } finally {
              await raf.close();
            }
          },
        ),
      );
    }
    if (refs.isEmpty) return;
    await _ingestPick(
      FolderPickResult(
        folderName: refs.length == 1 ? refs.first.name : '${refs.length} dosya',
        items: refs,
      ),
    );
  }

  Future<void> _ingestPick(FolderPickResult result) async {
    if (result.items.isEmpty) {
      setState(() {
        _status = '"${result.folderName}" içinde foto/video bulunamadı.';
      });
      return;
    }
    setState(() {
      _busy = true;
      _cancel = false;
      _status = '"${result.folderName}" okunuyor…';
    });
    try {
      final repo = context.read<MediaRepository>();
      final source = await repo.ensureSource(label: result.folderName);
      await _ingest(result.items, source: source);
    } catch (e) {
      if (!mounted) return;
      setState(() => _status = 'Klasör okunamadı: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _onDrop(DropDoneDetails details) async {
    if (_busy) return;
    final loose = <FolderMediaRef>[];
    for (final x in details.files) {
      final path = x.path;
      if (path.isEmpty) continue;
      if (FileSystemEntity.isDirectorySync(path)) {
        final result = await scanMediaDirectory(path);
        if (!mounted) return;
        await _ingestPick(result);
      } else if (FileSystemEntity.isFileSync(path) &&
          isMediaName(p.basename(path))) {
        final file = File(path);
        final size = await file.length();
        final name = p.basename(path);
        loose.add(
          FolderMediaRef(
            name: name,
            size: size,
            relativePath: name,
            localPath: path,
            lastModified: await file.lastModified(),
            readHead: (maxBytes) async {
              final n = size < maxBytes ? size : maxBytes;
              final raf = await file.open();
              try {
                return await raf.read(n);
              } finally {
                await raf.close();
              }
            },
          ),
        );
      }
    }
    if (loose.isEmpty || !mounted) return;
    await _ingestPick(
      FolderPickResult(
        folderName: loose.length == 1 ? loose.first.name : '${loose.length} dosya',
        items: loose,
      ),
    );
  }

  Future<void> _ingest(
    List<FolderMediaRef> files, {
    required MediaSource source,
  }) async {
    final repo = context.read<MediaRepository>();
    var withGps = 0;
    var added = 0;
    var missing = 0;
    for (var i = 0; i < files.length; i++) {
      if (_cancel) break;
      final file = files[i];
      if (mounted && i % 4 == 0) {
        setState(
          () => _status =
              '${source.label}: ${i + 1}/${files.length} · $withGps GPS · $missing yok',
        );
      }
      try {
        final kind = detectKind(file.name) ??
            (file.isVideo ? MediaKind.video : MediaKind.photo);
        if (!_kinds.contains(kind)) continue;
        final rel = file.relativePath ?? file.name;
        final existing = repo.findByIndex(
          sourceId: source.id,
          relativePath: rel,
          size: file.size,
        );
        if (existing != null) {
          added++;
          if (existing.hasLocation) {
            withGps++;
          } else {
            missing++;
          }
          continue;
        }
        final isPhoto = kind == MediaKind.photo;
        final headLimit = isPhoto
            ? (file.size <= previewStoreBytes ? file.size : photoHeadBytes)
            : videoHeadBytes;
        final head = await file.readHead(headLimit);
        final gps = isPhoto ? await extractExifGps(head) : extractHeaderGps(head);
        final taken = isPhoto
            ? await extractExifTakenAt(head) ?? file.lastModified
            : file.lastModified;
        if (gps != null) {
          withGps++;
        } else {
          missing++;
        }
        final preview = isPhoto && file.size <= previewStoreBytes ? head : null;
        await repo.add(
          name: file.name,
          kind: kind,
          sourceId: source.id,
          bytes: preview,
          relativePath: rel,
          localPath: file.localPath,
          sizeBytes: file.size,
          lat: gps?.latitude,
          lng: gps?.longitude,
          takenAt: taken,
          persist: i == files.length - 1 || i % 8 == 7,
        );
        added++;
      } catch (_) {
        missing++;
      }
    }
    await repo.flush();
    if (!mounted) return;
    setState(() {
      _showMissing = false;
      _panelCluster = null;
      _status = _cancel
          ? 'Tarama durdu: $added medya · $withGps GPS · $missing konum yok'
          : '"${source.label}": $added medya · $withGps GPS · $missing konum yok';
    });
    _fitVisible();
  }

  Future<void> _retryMissingGps() async {
    final repo = context.read<MediaRepository>();
    final targets = _missingOf(repo);
    if (targets.isEmpty) return;
    setState(() {
      _busy = true;
      _cancel = false;
      _status = 'GPS yeniden okunuyor…';
    });
    var found = 0;
    var checked = 0;
    try {
      for (var i = 0; i < targets.length; i++) {
        if (_cancel) break;
        final item = targets[i];
        if (mounted && i % 3 == 0) {
          setState(
            () => _status =
                'GPS yeniden: ${i + 1}/${targets.length} · $found bulundu',
          );
        }
        try {
          Uint8List? head;
          final path = item.localPath;
          if (path != null && path.isNotEmpty && File(path).existsSync()) {
            final file = File(path);
            final size = await file.length();
            final limit = item.kind == MediaKind.photo
                ? (size <= previewStoreBytes ? size : photoHeadBytes)
                : videoHeadBytes;
            final n = size < limit ? size : limit;
            final raf = await file.open();
            try {
              head = await raf.read(n);
            } finally {
              await raf.close();
            }
          } else {
            head = await repo.bytesOf(item.id);
          }
          if (head == null || head.isEmpty) continue;
          checked++;
          final gps = item.kind == MediaKind.photo
              ? await extractExifGps(head)
              : extractHeaderGps(head);
          if (gps == null) continue;
          final taken = item.kind == MediaKind.photo
              ? await extractExifTakenAt(head)
              : null;
          await repo.updateLocation(
            id: item.id,
            lat: gps.latitude,
            lng: gps.longitude,
            takenAt: taken,
            persist: false,
          );
          found++;
        } catch (_) {}
      }
      await repo.flush();
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _status = _cancel
              ? 'GPS durdu: $found konum bulundu'
              : 'GPS yeniden: $found konum bulundu · $checked dosya okundu';
        });
        if (found > 0) _fitVisible();
      }
    }
  }

  void _closeMenus() {
    _sourcesOpen = false;
    _kindMenu = null;
  }

  void _onSearchChanged(String raw) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 180), () async {
      if (!mounted) return;
      setState(() => _query = raw);
      if (raw.trim().length < 2) {
        setState(() => _places = []);
        return;
      }
      final hits = await searchPlaces(raw);
      if (!mounted || _searchCtrl.text != raw) return;
      setState(() => _places = hits);
    });
  }

  void _goToPlace(PlaceHit place) {
    setState(() {
      _places = [];
      _showMissing = false;
    });
    if (place.bbox != null && place.bbox!.length == 4) {
      final b = place.bbox!;
      _map.fitCamera(
        CameraFit.bounds(
          bounds: LatLngBounds(LatLng(b[0], b[2]), LatLng(b[1], b[3])),
          padding: const EdgeInsets.all(48),
          maxZoom: 14,
        ),
      );
    } else {
      _map.move(LatLng(place.latitude, place.longitude), 12);
    }
  }

  void _fitVisible() {
    final repo = context.read<MediaRepository>();
    final clusters = _clustersOf(repo);
    if (clusters.isEmpty) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      try {
        if (clusters.length == 1) {
          _map.move(clusters.first.latLng, 13);
          return;
        }
        _map.fitCamera(
          CameraFit.bounds(
            bounds: LatLngBounds.fromPoints([
              for (final c in clusters) c.latLng,
            ]),
            padding: const EdgeInsets.all(48),
            maxZoom: 15,
          ),
        );
      } catch (_) {
        /* harita henüz bağlı değil */
      }
    });
  }

  List<LibraryMedia> _filtered(MediaRepository repo) {
    return repo.visibleItems.where((m) {
      if (!_kinds.contains(m.kind)) return false;
      final source = repo.sourceOf(m.sourceId);
      return itemMatchesQuery(
        name: m.name,
        relativePath: m.relativePath,
        sourceLabel: source?.label,
        query: _query,
      );
    }).toList();
  }

  List<LocationCluster> _clustersOf(MediaRepository repo) {
    return groupByLocation(_filtered(repo).where((m) => m.hasLocation).toList());
  }

  List<LibraryMedia> _missingOf(MediaRepository repo) {
    return _filtered(repo).where((m) => !m.hasLocation).toList();
  }

  Future<void> _openCluster(LocationCluster cluster) async {
    if (_isDesktop) {
      setState(() {
        _panelCluster = cluster;
        _showMissing = false;
      });
      return;
    }
    if (cluster.items.length == 1) {
      await openMediaViewer(context, items: cluster.items);
      return;
    }
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) {
        final live = ctx.watch<MediaRepository>();
        return SizedBox(
          height: 320,
          child: _ClusterSheet(
            cluster: cluster,
            repo: live,
            onOpen: (index) {
              Navigator.pop(ctx);
              openMediaViewer(
                context,
                items: cluster.items,
                initialIndex: index,
              );
            },
          ),
        );
      },
    );
  }

  String _kindTitle(MediaKind kind) => switch (kind) {
        MediaKind.photo => 'Fotoğraflar',
        MediaKind.video => 'Telefon videoları',
        MediaKind.gopro => 'GoPro',
        MediaKind.drone => 'DJI / Drone videoları',
      };

  String _libraryStatus({
    required MediaRepository repo,
    required List<LibraryMedia> visible,
    required int clusterCount,
    required int missingCount,
  }) {
    final total = repo.items.length;
    final located = visible.where((m) => m.hasLocation).length;
    final buf = StringBuffer();
    if (visible.length != total && total > 0) {
      buf.write('Gösterilen ${visible.length} / ');
    }
    buf.write(
      "Toplam $total medya · $located GPS'li dosya · $clusterCount benzersiz konum",
    );
    if (missingCount > 0) {
      buf.write(' · $missingCount dosyada GPS yok');
    }
    return buf.toString();
  }

  void _toggleKind(MediaKind kind, bool on) {
    setState(() {
      if (on) {
        _kinds.add(kind);
      } else if (_kinds.length > 1) {
        _kinds.remove(kind);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MediaRepository>();
    final clusters = _clustersOf(repo);
    final missing = _missingOf(repo);
    final visible = _filtered(repo);
    final wide = MediaQuery.sizeOf(context).width >= 960;
    final locatedCount = visible.where((m) => m.hasLocation).length;
    final visibleSources = repo.sources.where((s) => !s.hidden).length;
    final sourceCount = repo.sources.isEmpty
        ? '0'
        : '$visibleSources/${repo.sources.length}';

    final body = CallbackShortcuts(
      bindings: {
        const SingleActivator(LogicalKeyboardKey.keyO, control: true):
            _busy ? () {} : _importFolder,
        const SingleActivator(LogicalKeyboardKey.escape): () {
          setState(() {
            _panelCluster = null;
            _places = [];
            _closeMenus();
            if (_showMissing) _showMissing = false;
          });
        },
      },
      child: Focus(
        autofocus: true,
        child: Scaffold(
          backgroundColor: const Color(0xFF071018),
          body: SafeArea(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _brandBar(clusters.isNotEmpty),
                _filterBar(
                  locatedCount: locatedCount,
                  missingCount: missing.length,
                  sourceCount: sourceCount,
                ),
                if (_sourcesOpen) _sourcesPanel(repo),
                if (_kindMenu != null)
                  _kindsPanel(
                    located: _kindMenu == 'located',
                    locatedItems: visible.where((m) => m.hasLocation),
                    missingItems: missing,
                  ),
                _statusBar(
                  repo: repo,
                  visible: visible,
                  clusterCount: clusters.length,
                  missingCount: missing.length,
                ),
                Expanded(
                  child: Row(
                    children: [
                      Expanded(child: _buildMain(clusters, missing)),
                      if (wide && _panelCluster != null) ...[
                        const VerticalDivider(width: 1),
                        SizedBox(
                          width: 340,
                          child: _ClusterSheet(
                            cluster: _panelCluster!,
                            repo: repo,
                            onClose: () =>
                                setState(() => _panelCluster = null),
                            onOpen: (index) => openMediaViewer(
                              context,
                              items: _panelCluster!.items,
                              initialIndex: index,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    return DropTarget(
      onDragEntered: (_) => setState(() => _dropping = true),
      onDragExited: (_) => setState(() => _dropping = false),
      onDragDone: (d) async {
        setState(() => _dropping = false);
        await _onDrop(d);
      },
      child: Stack(
        children: [
          body,
          if (_dropping)
            const ColoredBox(
              color: Color(0x88000000),
              child: Center(
                child: Text(
                  'Klasörü bırak — MedyaAtlas tarar, kopyalamaz',
                  style: TextStyle(fontSize: 20, color: Colors.white),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _brandBar(bool hasPins) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 8, 4),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text.rich(
                  TextSpan(
                    text: 'MedyaAtlas',
                    style: const TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.w600,
                      height: 1.05,
                      letterSpacing: -0.6,
                    ),
                    children: [
                      TextSpan(
                        text: '  v$appVersion',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: Colors.white.withValues(alpha: 0.55),
                          letterSpacing: 0.2,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Dünya haritasında medya izlerin',
                  style: TextStyle(
                    fontSize: 13,
                    color: Colors.white.withValues(alpha: 0.55),
                  ),
                ),
              ],
            ),
          ),
          if (_busy)
            TextButton(
              onPressed: () => setState(() => _cancel = true),
              style: TextButton.styleFrom(
                foregroundColor: const Color(0xFFFF7A59),
              ),
              child: const Text('İptal'),
            )
          else
            IconButton(
              tooltip: 'Tüm pinler',
              onPressed: hasPins ? _fitVisible : null,
              icon: const Icon(Icons.zoom_out_map),
            ),
        ],
      ),
    );
  }

  Widget _filterBar({
    required int locatedCount,
    required int missingCount,
    required String sourceCount,
  }) {
    return Material(
      color: const Color(0x85050E16),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
        child: Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            SizedBox(
              width: 240,
              child: TextField(
                controller: _searchCtrl,
                onChanged: _onSearchChanged,
                style: const TextStyle(fontSize: 13),
                decoration: InputDecoration(
                  isDense: true,
                  hintText: 'Dosya veya konum ara…',
                  prefixIcon: const Icon(Icons.search, size: 18),
                  suffixIcon: _query.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.close, size: 16),
                          onPressed: () {
                            _searchCtrl.clear();
                            _onSearchChanged('');
                          },
                        ),
                  filled: true,
                  fillColor: const Color(0xFF0C2230),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 8,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(9),
                    borderSide: const BorderSide(color: Color(0x1FF2F6F8)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(9),
                    borderSide: const BorderSide(color: Color(0x1FF2F6F8)),
                  ),
                ),
              ),
            ),
            _CountPill(
              label: 'Medya kaynakları',
              count: sourceCount,
              selected: _sourcesOpen,
              onTap: () => setState(() {
                _sourcesOpen = !_sourcesOpen;
                if (_sourcesOpen) _kindMenu = null;
              }),
            ),
            _CountPill(
              label: 'GPS konumlu',
              count: '$locatedCount',
              selected: !_showMissing,
              onTap: () => setState(() {
                _showMissing = false;
                _panelCluster = null;
                _sourcesOpen = false;
                _kindMenu = _kindMenu == 'located' ? null : 'located';
              }),
            ),
            _CountPill(
              label: 'Konum bulunamayan',
              count: '$missingCount',
              selected: _showMissing,
              onTap: () => setState(() {
                _showMissing = true;
                _panelCluster = null;
                _sourcesOpen = false;
                _kindMenu = _kindMenu == 'missing' ? null : 'missing';
              }),
            ),
            if (missingCount > 0)
              TextButton(
                onPressed: _busy ? null : _retryMissingGps,
                child: const Text('Konum yokları yeniden dene'),
              ),
            if (MediaQuery.sizeOf(context).width >= 1100)
              Padding(
                padding: const EdgeInsets.only(left: 8),
                child: Text(
                  'Geliştiren Ali Dinçer',
                  style: TextStyle(
                    fontSize: 11,
                    color: Colors.white.withValues(alpha: 0.4),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _sourcesPanel(MediaRepository repo) {
    return Material(
      color: const Color(0xF00A1C28),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 280),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          children: [
            if (repo.sources.isEmpty)
              Text(
                _isDesktop
                    ? 'Henüz kaynak yok. Klasör veya dosya ekle — tarama kopyalamaz. Sürükle-bırak veya Ctrl+O.'
                    : 'Henüz kaynak yok. Klasör veya galeri ekle.',
                style: TextStyle(
                  fontSize: 13,
                  color: Colors.white.withValues(alpha: 0.6),
                ),
              ),
            for (final source in repo.sources)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: Icon(
                  source.hidden
                      ? Icons.visibility_off_outlined
                      : Icons.visibility_outlined,
                ),
                title: Text(source.label, overflow: TextOverflow.ellipsis),
                subtitle: Text(
                  '${repo.items.where((m) => m.sourceId == source.id).length} medya',
                ),
                onTap: () => repo.setSourceHidden(source.id, !source.hidden),
                trailing: IconButton(
                  tooltip: 'Kaynağı sil',
                  onPressed: () => repo.removeSource(source.id),
                  icon: const Icon(Icons.delete_outline),
                ),
              ),
            const SizedBox(height: 4),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.tonal(
                  onPressed: _busy
                      ? null
                      : () {
                          setState(_closeMenus);
                          _importFolder();
                        },
                  child: const Text('+ Klasör ekle'),
                ),
                FilledButton.tonal(
                  onPressed: _busy
                      ? null
                      : () {
                          setState(_closeMenus);
                          _importFiles();
                        },
                  child: const Text('+ Dosya seç'),
                ),
                if (!_isDesktop)
                  FilledButton.tonal(
                    onPressed: _busy
                        ? null
                        : () {
                            setState(_closeMenus);
                            _importGallery();
                          },
                    child: const Text('+ Galeri'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _kindsPanel({
    required bool located,
    required Iterable<LibraryMedia> locatedItems,
    required List<LibraryMedia> missingItems,
  }) {
    final pool = located ? locatedItems : missingItems;
    return Material(
      color: const Color(0xF00A1C28),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
        child: Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            for (final kind in MediaKind.values)
              FilterChip(
                selected: _kinds.contains(kind),
                label: Text(
                  '${_kindTitle(kind)} ${pool.where((m) => m.kind == kind).length}',
                ),
                onSelected: (on) => _toggleKind(kind, on),
              ),
          ],
        ),
      ),
    );
  }

  Widget _statusBar({
    required MediaRepository repo,
    required List<LibraryMedia> visible,
    required int clusterCount,
    required int missingCount,
  }) {
    if (!_busy && repo.items.isEmpty && _status == null) {
      return const SizedBox.shrink();
    }
    final text = _busy
        ? '${_status ?? 'Dosyalar aranıyor…'} — durdurmak için İptal'
        : (_status ??
            _libraryStatus(
              repo: repo,
              visible: visible,
              clusterCount: clusterCount,
              missingCount: missingCount,
            ));
    return Material(
      color: const Color(0x33000000),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 6, 8, 6),
        child: Row(
          children: [
            if (_busy) ...[
              const SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: 10),
            ],
            Expanded(
              child: Text(
                text,
                style: const TextStyle(fontSize: 13),
              ),
            ),
            if (!_busy && _status != null)
              IconButton(
                icon: const Icon(Icons.close, size: 16),
                onPressed: () => setState(() => _status = null),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildMain(List<LocationCluster> clusters, List<LibraryMedia> missing) {
    return Stack(
      children: [
        _showMissing
            ? _MissingList(
                items: missing,
                onOpen: (item) => openMediaViewer(
                  context,
                  items: missing,
                  initialIndex: missing.indexOf(item),
                ),
              )
            : FlutterMap(
                mapController: _map,
                options: const MapOptions(
                  initialCenter: _worldCenter,
                  initialZoom: 2.4,
                ),
                children: [
                  TileLayer(
                    urlTemplate:
                        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                    userAgentPackageName: 'com.medyaatlas.app',
                  ),
                  MarkerLayer(
                    markers: [
                      for (final cluster in clusters)
                        Marker(
                          point: cluster.latLng,
                          width: 44,
                          height: 44,
                          child: GestureDetector(
                            onTap: () => _openCluster(cluster),
                            child: ClusterDot(count: cluster.items.length),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
        if (_places.isNotEmpty)
          Positioned(
            left: 12,
            right: 12,
            top: 8,
            child: Material(
              elevation: 6,
              borderRadius: BorderRadius.circular(8),
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final p in _places)
                    ListTile(
                      dense: true,
                      leading: const Icon(Icons.place_outlined),
                      title: Text(p.label, maxLines: 2),
                      onTap: () => _goToPlace(p),
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _CountPill extends StatelessWidget {
  const _CountPill({
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? const Color(0x212EC4B6) : const Color(0x0DFFFFFF),
      shape: StadiumBorder(
        side: BorderSide(
          color: selected
              ? const Color(0x732EC4B6)
              : const Color(0x1FF2F6F8),
        ),
      ),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                decoration: BoxDecoration(
                  color: const Color(0x14FFFFFF),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  count,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MissingList extends StatelessWidget {
  const _MissingList({required this.items, required this.onOpen});

  final List<LibraryMedia> items;
  final ValueChanged<LibraryMedia> onOpen;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const Center(child: Text('Konumu olmayan medya yok.'));
    }
    return ListView.separated(
      itemCount: items.length,
      separatorBuilder: (context, index) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final item = items[i];
        return ListTile(
          leading: Icon(
            item.kind == MediaKind.photo
                ? Icons.photo_outlined
                : Icons.videocam_outlined,
          ),
          title: Text(item.name, overflow: TextOverflow.ellipsis),
          subtitle: Text(
            [
              kindLabel(item.kind, en: false),
              if (item.relativePath != null) item.relativePath!,
            ].join(' · '),
            overflow: TextOverflow.ellipsis,
          ),
          onTap: () => onOpen(item),
        );
      },
    );
  }
}

class _ClusterSheet extends StatelessWidget {
  const _ClusterSheet({
    required this.cluster,
    required this.repo,
    required this.onOpen,
    this.onClose,
  });

  final LocationCluster cluster;
  final MediaRepository repo;
  final ValueChanged<int> onOpen;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${cluster.items.length} medya',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              if (onClose != null)
                IconButton(
                  tooltip: 'Kapat',
                  onPressed: onClose,
                  icon: const Icon(Icons.close),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Expanded(
            child: GridView.builder(
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3,
                mainAxisSpacing: 6,
                crossAxisSpacing: 6,
              ),
              itemCount: cluster.items.length,
              itemBuilder: (context, i) {
                final item = cluster.items[i];
                return GestureDetector(
                  onTap: () => onOpen(i),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: _Thumb(item: item, repo: repo),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _Thumb extends StatelessWidget {
  const _Thumb({required this.item, required this.repo});

  final LibraryMedia item;
  final MediaRepository repo;

  @override
  Widget build(BuildContext context) {
    if (item.kind != MediaKind.photo) {
      return ColoredBox(
        color: Colors.black26,
        child: Icon(
          item.kind == MediaKind.drone ? Icons.flight : Icons.videocam,
        ),
      );
    }
    final fromDisk = photoFromPath(item.localPath, fit: BoxFit.cover);
    if (fromDisk != null) return fromDisk;
    final cached = repo.cachedBytes(item.id);
    if (cached != null) {
      return Image.memory(cached, fit: BoxFit.cover);
    }
    return FutureBuilder(
      future: repo.bytesOf(item.id),
      builder: (context, snap) {
        final bytes = snap.data;
        if (bytes == null) {
          return const ColoredBox(
            color: Colors.black26,
            child: Icon(Icons.photo_outlined),
          );
        }
        return Image.memory(bytes, fit: BoxFit.cover);
      },
    );
  }
}
