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
import '../google_oauth_config.dart';
import '../models/library_media.dart';
import '../repositories/media_repository.dart';
import '../services/android_media_scan.dart';
import '../services/app_updater.dart';
import '../services/cluster.dart';
import '../services/exif_gps.dart';
import '../services/folder_picker.dart';
import '../services/geo.dart';
import '../services/google_drive_media.dart';
import '../services/header_gps.dart';
import '../services/media_permissions.dart';
import '../services/place_search.dart';
import '../services/search_text.dart';
import '../services/video_preview.dart';
import '../widgets/cluster_dot.dart';
import '../widgets/media_viewer.dart';
import '../widgets/photo_source.dart';
import '../services/photo_orient.dart';
import 'package:permission_handler/permission_handler.dart';

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
  bool _searchOpen = false;
  String? _kindMenu;
  String? _status;
  bool _showMissing = false;
  String _query = '';
  List<PlaceHit> _places = [];
  LocationCluster? _panelCluster;
  final Set<MediaKind> _kinds = {...MediaKind.values};

  /// Tarama sırasında harita pinlerini dondur — ara notifyListeners NaN pin
  /// ile MarkerLayer'ı düşürmesin.
  List<LocationCluster> _mapClusters = const [];

  List<LocationCluster> _safeClusters(MediaRepository repo) {
    try {
      return [
        for (final c in _clustersOf(repo))
          if (c.latitude.isFinite && c.longitude.isFinite) c,
      ];
    } catch (_) {
      return const [];
    }
  }

  void _beginBusy() {
    final repo = context.read<MediaRepository>();
    _mapClusters = _safeClusters(repo);
    _busy = true;
    _cancel = false;
  }

  void _endBusy() {
    _busy = false;
    _mapClusters = _safeClusters(context.read<MediaRepository>());
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _checkForUpdates();
    });
  }

  Future<void> _checkForUpdates({bool manual = false}) async {
    if (kIsWeb || !supportsInAppUpdate) {
      if (manual && mounted) {
        setState(() => _status = 'Bu platformda uygulama içi güncelleme yok.');
      }
      return;
    }
    if (manual && mounted) {
      setState(() => _status = 'Güncelleme kontrol ediliyor…');
    }
    final info = await fetchLatestRelease();
    if (!mounted) return;
    if (info == null) {
      if (manual) setState(() => _status = 'Sürüm kontrolü başarısız (ağ).');
      return;
    }
    if (!info.isNewer) return;
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Güncelleme var: v${info.latestVersion}'),
        content: Text(info.dialogBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Sonra'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('İndir'),
          ),
        ],
      ),
    );
    if (go != true || !mounted) return;

    if (info.platform == UpdatePlatform.android) {
      final installPerm = await Permission.requestInstallPackages.request();
      if (!installPerm.isGranted) {
        if (!mounted) return;
        setState(
          () => _status =
              'Kurulum izni gerekli: Ayarlar → Bilinmeyen uygulamaları yükle.',
        );
        await openAppSettings();
        return;
      }
    }

    if (!mounted) return;
    final progress = ValueNotifier<double>(0);
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => PopScope(
        canPop: false,
        child: AlertDialog(
          title: const Text('Güncelleme indiriliyor'),
          content: ValueListenableBuilder<double>(
            valueListenable: progress,
            builder: (context, value, _) => Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                LinearProgressIndicator(
                  value: value <= 0 ? null : value.clamp(0.0, 1.0),
                ),
                const SizedBox(height: 12),
                Text('%${(value * 100).round()} — ${info.assetName}'),
              ],
            ),
          ),
        ),
      ),
    );

    final err = await downloadAndApplyUpdate(
      info,
      onProgress: (p) => progress.value = p,
    );
    progress.dispose();
    if (mounted) Navigator.of(context, rootNavigator: true).pop();
    if (!mounted) return;
    setState(() {
      if (err != null) {
        _status = err;
      } else if (info.platform == UpdatePlatform.android) {
        _status = 'Kurulum ekranı açıldı — Güncelle’ye basın (silmeden üzerine kurar).';
      } else {
        _status =
            'v${info.latestVersion} indirildi. Bu uygulamayı kapatıp '
            'yeni medyaatlas.exe ile açın.';
      }
    });
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<bool> _ensureAndroidMediaAccess() async {
    final result = await ensureAndroidMediaAccess();
    if (!result.ok) {
      if (mounted) {
        setState(() => _status = result.message);
      }
      return false;
    }
    return true;
  }

  Future<void> _importEntirePhone() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) {
      setState(() => _status = 'Tüm telefon tarama yalnızca Android’de.');
      return;
    }
    if (!await _ensureAndroidMediaAccess()) return;
    setState(() {
      _beginBusy();
      _status = 'Telefon taranıyor…';
    });
    try {
      final picked = await scanEntirePhoneMedia(
        onProgress: (s) {
          if (mounted) setState(() => _status = s);
        },
      );
      if (!mounted) return;
      setState(_endBusy);
      if (picked.items.isEmpty) {
        setState(() => _status = 'Telefonda foto/video bulunamadı.');
        return;
      }
      await _ingestPick(picked);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _endBusy();
        _status = 'Telefon tarama: $e';
      });
    }
  }

  Future<void> _importGallery() async {
    if (!await _ensureAndroidMediaAccess()) return;
    setState(() {
      _beginBusy();
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
      if (mounted) setState(_endBusy);
    }
  }

  Future<void> _importGoogleDrive() async {
    setState(() {
      _beginBusy();
      _status = 'Google Drive’a bağlanılıyor…';
    });
    GoogleDriveSession? session;
    try {
      session = await connectGoogleDrive();
      if (!mounted) return;
      setState(() => _status = 'Drive: ${session!.email} — medya listeleniyor…');
      final picked = await listDriveMedia(
        session,
        onProgress: (s) {
          if (mounted) setState(() => _status = s);
        },
      );
      if (!mounted) return;
      if (picked.items.isEmpty) {
        setState(() => _status = 'Drive’da foto/video bulunamadı.');
        return;
      }
      final repo = context.read<MediaRepository>();
      final source = await repo.ensureSource(label: picked.folderName);
      await _ingest(picked.items, source: source);
    } catch (e) {
      if (!mounted) return;
      setState(() => _status = _googleDriveErrorMessage(e));
    } finally {
      session?.close();
      if (mounted) setState(_endBusy);
    }
  }

  String _googleDriveErrorMessage(Object e) {
    final msg = '$e';
    final lower = msg.toLowerCase();
    if (lower.contains('serverclientid') ||
        lower.contains('clientconfiguration') ||
        msg.contains(googleDriveConfigHelp) ||
        (!hasGoogleServerClientId && Platform.isAndroid)) {
      return googleDriveConfigHelp;
    }
    if (msg.contains('10') || lower.contains('apiexception')) {
      return 'Google oturum açılamadı. Android OAuth istemcisine '
          'SHA-1 ekleyin ve Drive API’yi açın (GOOGLE_DRIVE.md).';
    }
    return 'Google Drive: $e';
  }

  Future<void> _importFolder() async {
    if (!await _ensureAndroidMediaAccess()) return;
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
    if (!await _ensureAndroidMediaAccess()) return;
    // Windows’ta uzun uzantı listeli FileType.custom bazen yalnızca
    // görüntü filtreler — any alıp istemci tarafında medya süzüyoruz.
    final picked = await FilePicker.platform.pickFiles(
      allowMultiple: true,
      type: FileType.any,
      withData: false,
    );
    if (!mounted || picked == null || picked.files.isEmpty) return;
    final refs = <FolderMediaRef>[];
    for (final file in picked.files) {
      final path = file.path;
      if (path == null) continue;
      if (!isMediaName(file.name)) continue;
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
    if (refs.isEmpty) {
      setState(() {
        _status =
            'Seçilenlerde foto/video yok. Desteklenen: JPG, PNG, MP4, MOV, GoPro, DJI…';
      });
      return;
    }
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
    final videoCount = result.items.where((f) => f.isVideo).length;
    final photoCount = result.items.length - videoCount;
    setState(() {
      _beginBusy();
      _status =
          '"${result.folderName}" okunuyor… ($photoCount foto · $videoCount video)';
    });
    try {
      final repo = context.read<MediaRepository>();
      final source = await repo.ensureSource(label: result.folderName);
      await _ingest(result.items, source: source);
    } catch (e) {
      if (!mounted) return;
      final msg = '$e';
      setState(() {
        _status = msg.contains('encodable') || msg.contains('NaN')
            ? 'Bazı dosyalarda bozuk GPS vardı; geçerli medya yine eklendi. Uygulama 0.6.2+ olmalı.'
            : 'Klasör okunamadı: $e';
      });
    } finally {
      if (mounted) setState(_endBusy);
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
    var failed = 0;
    final kindCounts = {for (final k in MediaKind.values) k: 0};

    // Tür filtresi yalnızca harita/liste görünümünü etkiler — tarama her
    // zaman foto + video + GoPro + drone ekler.
    for (var i = 0; i < files.length; i++) {
      if (_cancel) break;
      final file = files[i];
      if (mounted && i % 4 == 0) {
        setState(
          () => _status =
              '${source.label}: ${i + 1}/${files.length} · $withGps GPS · $missing yok · ${kindCountsLabel(kindCounts)}',
        );
      }
      final kind = detectKind(file.name) ??
          (file.isVideo ? MediaKind.video : MediaKind.photo);
      final rel = file.relativePath ?? file.name;
      try {
        final existing = repo.findByIndex(
          sourceId: source.id,
          relativePath: rel,
          size: file.size,
        );
        if (existing != null) {
          // Eski kayıtta video önizlemesi yoksa tarama sırasında doldur.
          if (existing.isVideo) {
            final hasPreview = repo.cachedBytes(existing.id) != null ||
                await repo.bytesOf(existing.id) != null;
            if (!hasPreview) {
              Uint8List? head;
              try {
                head = await file.readHead(videoHeadBytes);
              } catch (_) {}
              final preview = await extractVideoPreviewBytes(
                localPath: file.localPath,
                head: head,
              );
              if (preview != null) {
                await repo.putPreviewBytes(existing.id, preview);
              }
            }
          }
          added++;
          kindCounts[existing.kind] = (kindCounts[existing.kind] ?? 0) + 1;
          if (existing.hasLocation) {
            withGps++;
          } else {
            missing++;
          }
          continue;
        }
        final isPhoto = kind == MediaKind.photo;
        // size==0 (MediaStore) iken EXIF için varsayılan head boyutu kullan.
        final headLimit = isPhoto
            ? (file.size <= 0
                ? photoHeadBytes
                : (file.size <= previewStoreBytes
                    ? file.size
                    : photoHeadBytes))
            : videoHeadBytes;

        LatLng? gps;
        DateTime? taken = file.lastModified;
        if (file.knownLat != null && file.knownLng != null) {
          gps = latLngOrNull(file.knownLat, file.knownLng);
        }

        Uint8List? head;
        final needHead = gps == null ||
            (isPhoto && file.size > 0 && file.size <= previewStoreBytes);
        if (needHead) {
          try {
            head = await file.readHead(
              gps != null && isPhoto && file.size > 0 ? file.size : headLimit,
            );
          } catch (_) {
            head = null;
          }
        }

        if (gps == null && head != null && head.isNotEmpty) {
          try {
            if (isPhoto) {
              gps = await extractExifGps(head);
              taken = await extractExifTakenAt(head) ?? taken;
            } else {
              gps = extractHeaderGps(head);
            }
          } catch (_) {
            // GPS okunamasa da dosya kütüphaneye girer.
          }
        }
        // NaN/Infinity asla Hive/jsonEncode veya MarkerLayer'a girmesin.
        if (gps != null &&
            !(gps.latitude.isFinite && gps.longitude.isFinite)) {
          gps = null;
        }

        if (gps != null) {
          withGps++;
        } else {
          missing++;
        }
        final preview = isPhoto
            ? (head != null && file.size <= previewStoreBytes ? head : null)
            : await extractVideoPreviewBytes(
                localPath: file.localPath,
                head: head,
              );
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
          // Tarama bitene kadar haritayı yenileme — NaN pin anında çökertmesin.
          notify: false,
        );
        added++;
        kindCounts[kind] = (kindCounts[kind] ?? 0) + 1;
      } catch (_) {
        failed++;
      }
    }
    await repo.flush(notify: true);
    if (!mounted) return;
    final kindsText = kindCountsLabel(kindCounts);
    final failText = failed > 0 ? ' · $failed okunamadı' : '';
    setState(() {
      _showMissing = false;
      _panelCluster = null;
      // Yeni eklenen türler haritada görünsün diye filtreyi aç.
      _kinds.addAll(MediaKind.values);
      _status = _cancel
          ? 'Tarama durdu: $added medya ($kindsText) · $withGps GPS · $missing konum yok$failText'
          : '"${source.label}": $added medya ($kindsText) · $withGps GPS · $missing konum yok$failText';
    });
    _fitVisible();
  }

  Future<void> _retryMissingGps() async {
    final repo = context.read<MediaRepository>();
    final targets = _missingOf(repo);
    if (targets.isEmpty) return;
    setState(() {
      _beginBusy();
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
          LatLng? gps;
          DateTime? taken;
          final phoneId = phoneAssetIdFromRelativePath(item.relativePath);
          if (phoneId != null && Platform.isAndroid) {
            final got = await readPhoneAssetGps(
              assetId: phoneId,
              isPhoto: item.kind == MediaKind.photo,
              headLimit: item.kind == MediaKind.photo
                  ? photoHeadBytes
                  : videoHeadBytes,
            );
            checked++;
            if (got.lat != null && got.lng != null) {
              gps = latLngOrNull(got.lat, got.lng);
            }
            if (gps == null && got.head != null && got.head!.isNotEmpty) {
              gps = item.kind == MediaKind.photo
                  ? await extractExifGps(got.head!)
                  : extractHeaderGps(got.head!);
              if (item.kind == MediaKind.photo) {
                taken = await extractExifTakenAt(got.head!);
              }
            }
          } else {
            Uint8List? head;
            final path = item.localPath;
            if (path != null && path.isNotEmpty && File(path).existsSync()) {
              final file = File(path);
              final size = await file.length();
              final limit = item.kind == MediaKind.photo
                  ? (size <= 0
                      ? photoHeadBytes
                      : (size <= previewStoreBytes ? size : photoHeadBytes))
                  : videoHeadBytes;
              final n = size < limit ? size : limit;
              if (n > 0) {
                final raf = await file.open();
                try {
                  head = await raf.read(n);
                } finally {
                  await raf.close();
                }
              }
            } else {
              head = await repo.bytesOf(item.id);
            }
            if (head == null || head.isEmpty) continue;
            checked++;
            gps = item.kind == MediaKind.photo
                ? await extractExifGps(head)
                : extractHeaderGps(head);
            if (item.kind == MediaKind.photo) {
              taken = await extractExifTakenAt(head);
            }
          }
          if (gps == null) continue;
          await repo.updateLocation(
            id: item.id,
            lat: gps.latitude,
            lng: gps.longitude,
            takenAt: taken,
            persist: false,
            notify: false,
          );
          found++;
        } catch (_) {}
      }
      await repo.flush(notify: true);
    } finally {
      if (mounted) {
        setState(() {
          _endBusy();
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
    _searchOpen = false;
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
    final points = [
      for (final c in clusters)
        if (c.latLng.latitude.isFinite && c.latLng.longitude.isFinite) c.latLng,
    ];
    if (points.isEmpty) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      try {
        if (points.length == 1) {
          _map.move(points.first, 13);
          return;
        }
        _map.fitCamera(
          CameraFit.bounds(
            bounds: LatLngBounds.fromPoints(points),
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
    // Tarama sürerken dondurulmuş (sonlu) pinler; bitince taze liste.
    final clusters = _busy ? _mapClusters : _safeClusters(repo);
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
            child: Stack(
              children: [
                Positioned.fill(
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
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _mapTopBar(
                        hasPins: clusters.isNotEmpty,
                        locatedCount: locatedCount,
                        missingCount: missing.length,
                        sourceCount: sourceCount,
                      ),
                      if (_searchOpen) _searchOverlay(),
                      if (_sourcesOpen)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(10, 0, 10, 8),
                          child: Material(
                            elevation: 8,
                            color: const Color(0xF00A1C28),
                            borderRadius: BorderRadius.circular(12),
                            clipBehavior: Clip.antiAlias,
                            child: _sourcesPanel(repo),
                          ),
                        ),
                      if (_kindMenu != null)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(10, 0, 10, 8),
                          child: Material(
                            elevation: 8,
                            color: const Color(0xF00A1C28),
                            borderRadius: BorderRadius.circular(12),
                            clipBehavior: Clip.antiAlias,
                            child: _kindsPanel(
                              located: _kindMenu == 'located',
                              locatedItems:
                                  visible.where((m) => m.hasLocation),
                              missingItems: missing,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                if (_busy || (_status != null && _status!.isNotEmpty))
                  Positioned(
                    left: 12,
                    right: 12,
                    bottom: 12,
                    child: _statusChip(
                      repo: repo,
                      visible: visible,
                      clusterCount: clusters.length,
                      missingCount: missing.length,
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

  Widget _mapTopBar({
    required bool hasPins,
    required int locatedCount,
    required int missingCount,
    required String sourceCount,
  }) {
    return Material(
      color: const Color(0xCC050E16),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 6, 4, 6),
        child: Row(
          children: [
            Expanded(
              child: Text.rich(
                TextSpan(
                  text: 'MedyaAtlas',
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w600,
                    height: 1.1,
                    letterSpacing: -0.5,
                  ),
                  children: [
                    TextSpan(
                      text: '  v$appVersion',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: Colors.white.withValues(alpha: 0.5),
                      ),
                    ),
                  ],
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
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
            else ...[
              _TopIcon(
                tooltip: 'Ara',
                selected: _searchOpen,
                icon: Icons.search,
                onPressed: () => setState(() {
                  _searchOpen = !_searchOpen;
                  if (_searchOpen) {
                    _sourcesOpen = false;
                    _kindMenu = null;
                  }
                }),
              ),
              _TopIcon(
                tooltip: 'Medya kaynakları',
                selected: _sourcesOpen,
                icon: Icons.folder_outlined,
                badge: sourceCount,
                onPressed: () => setState(() {
                  _sourcesOpen = !_sourcesOpen;
                  if (_sourcesOpen) {
                    _kindMenu = null;
                    _searchOpen = false;
                  }
                }),
              ),
              _TopIcon(
                tooltip: 'GPS konumlu',
                selected: !_showMissing && _kindMenu == 'located',
                icon: Icons.location_on_outlined,
                badge: '$locatedCount',
                onPressed: () => setState(() {
                  _showMissing = false;
                  _panelCluster = null;
                  _sourcesOpen = false;
                  _searchOpen = false;
                  _kindMenu = _kindMenu == 'located' ? null : 'located';
                }),
              ),
              _TopIcon(
                tooltip: 'Konum bulunamayan',
                selected: _showMissing,
                icon: Icons.location_off_outlined,
                badge: '$missingCount',
                onPressed: () => setState(() {
                  _showMissing = true;
                  _panelCluster = null;
                  _sourcesOpen = false;
                  _searchOpen = false;
                  _kindMenu = _kindMenu == 'missing' ? null : 'missing';
                }),
              ),
              _TopIcon(
                tooltip: 'Tüm pinler',
                icon: Icons.zoom_out_map,
                onPressed: hasPins ? _fitVisible : null,
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _searchOverlay() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 0, 10, 8),
      child: Material(
        elevation: 6,
        color: const Color(0xF00A1C28),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 4, 4, 4),
          child: TextField(
            controller: _searchCtrl,
            autofocus: true,
            onChanged: _onSearchChanged,
            style: const TextStyle(fontSize: 14),
            decoration: InputDecoration(
              isDense: true,
              hintText: 'Dosya veya konum ara…',
              prefixIcon: const Icon(Icons.search, size: 20),
              suffixIcon: IconButton(
                icon: const Icon(Icons.close, size: 18),
                onPressed: () {
                  _searchCtrl.clear();
                  _onSearchChanged('');
                  setState(() => _searchOpen = false);
                },
              ),
              border: InputBorder.none,
            ),
          ),
        ),
      ),
    );
  }

  Widget _statusChip({
    required MediaRepository repo,
    required List<LibraryMedia> visible,
    required int clusterCount,
    required int missingCount,
  }) {
    final text = _busy
        ? '${_status ?? 'Dosyalar aranıyor…'} — İptal üstte'
        : (_status ??
            _libraryStatus(
              repo: repo,
              visible: visible,
              clusterCount: clusterCount,
              missingCount: missingCount,
            ));
    return Material(
      elevation: 6,
      color: const Color(0xE00A1C28),
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
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
              child: Text(text, style: const TextStyle(fontSize: 13)),
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

  Widget _sourcesPanel(MediaRepository repo) {
    return ConstrainedBox(
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
                          _importEntirePhone();
                        },
                  child: const Text('+ Tüm telefon'),
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
              FilledButton.tonal(
                onPressed: _busy
                    ? null
                    : () {
                        setState(_closeMenus);
                        _importGoogleDrive();
                      },
                child: const Text('+ Google Drive'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _kindsPanel({
    required bool located,
    required Iterable<LibraryMedia> locatedItems,
    required List<LibraryMedia> missingItems,
  }) {
    final pool = located ? locatedItems : missingItems;
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            located ? 'GPS konumlu filtre' : 'Konumu olmayanlar',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: Colors.white.withValues(alpha: 0.7),
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
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
          if (!located && missingItems.isNotEmpty) ...[
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: _busy ? null : _retryMissingGps,
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Konum yokları yeniden dene'),
            ),
          ],
        ],
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
                    markers: _markersFor(clusters),
                  ),
                ],
              ),
        if (_places.isNotEmpty)
          Positioned(
            left: 12,
            right: 12,
            top: 56,
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

  List<Marker> _markersFor(List<LocationCluster> clusters) {
    final out = <Marker>[];
    for (final cluster in clusters) {
      final lat = cluster.latitude;
      final lng = cluster.longitude;
      if (!lat.isFinite || !lng.isFinite) continue;
      if (lat.abs() > 90 || lng.abs() > 180) continue;
      out.add(
        Marker(
          point: LatLng(lat, lng),
          width: 44,
          height: 44,
          child: GestureDetector(
            onTap: () => _openCluster(cluster),
            child: ClusterDot(count: cluster.items.length),
          ),
        ),
      );
    }
    return out;
  }
}

class _TopIcon extends StatelessWidget {
  const _TopIcon({
    required this.tooltip,
    required this.icon,
    this.badge,
    this.selected = false,
    this.onPressed,
  });

  final String tooltip;
  final IconData icon;
  final String? badge;
  final bool selected;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final color = selected
        ? const Color(0xFF2EC4B6)
        : Colors.white.withValues(alpha: 0.85);
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      icon: Badge(
        isLabelVisible: badge != null && badge != '0' && badge != '0/0',
        label: Text(
          badge ?? '',
          style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700),
        ),
        backgroundColor: const Color(0xFFFF7A59),
        child: Icon(icon, color: color),
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
        final repo = context.read<MediaRepository>();
        return ListTile(
          leading: SizedBox(
            width: 56,
            height: 56,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: item.isVideo
                  ? _VideoThumbCached(item: item, repo: repo)
                  : (photoFromPath(item.localPath, fit: BoxFit.cover) ??
                      const ColoredBox(
                        color: Colors.black26,
                        child: Icon(Icons.photo_outlined),
                      )),
            ),
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
    if (item.isVideo) {
      return _VideoThumbCached(item: item, repo: repo);
    }
    final fromDisk = photoFromPath(item.localPath, fit: BoxFit.cover);
    if (fromDisk != null) return fromDisk;
    final cached = repo.cachedBytes(item.id);
    if (cached != null) {
      return OrientedMemoryImage(cached, fit: BoxFit.cover);
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
        return OrientedMemoryImage(bytes, fit: BoxFit.cover);
      },
    );
  }
}

/// Tarama sırasında kaydedilen JPEG; yoksa bir kez çıkarır (video_player yok).
class _VideoThumbCached extends StatefulWidget {
  const _VideoThumbCached({required this.item, required this.repo});

  final LibraryMedia item;
  final MediaRepository repo;

  @override
  State<_VideoThumbCached> createState() => _VideoThumbCachedState();
}

class _VideoThumbCachedState extends State<_VideoThumbCached> {
  Uint8List? _bytes;
  var _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant _VideoThumbCached oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.item.id != widget.item.id) {
      _bytes = null;
      _loading = true;
      _load();
    }
  }

  Future<void> _load() async {
    final cached = widget.repo.cachedBytes(widget.item.id) ??
        await widget.repo.bytesOf(widget.item.id);
    if (cached != null && cached.isNotEmpty) {
      if (mounted) {
        setState(() {
          _bytes = cached;
          _loading = false;
        });
      }
      return;
    }
    final extracted = await extractVideoPreviewBytes(
      localPath: widget.item.localPath,
    );
    if (extracted != null && extracted.isNotEmpty) {
      await widget.repo.putPreviewBytes(widget.item.id, extracted);
      if (mounted) {
        setState(() {
          _bytes = extracted;
          _loading = false;
        });
      }
      return;
    }
    if (mounted) setState(() => _loading = false);
  }

  @override
  Widget build(BuildContext context) {
    final bytes = _bytes;
    if (bytes != null) {
      return Stack(
        fit: StackFit.expand,
        children: [
          OrientedMemoryImage(bytes, fit: BoxFit.cover),
          const Align(
            alignment: Alignment.bottomRight,
            child: Padding(
              padding: EdgeInsets.all(4),
              child: Icon(
                Icons.play_circle_fill,
                size: 22,
                color: Colors.white70,
              ),
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
            : Icon(
                widget.item.kind == MediaKind.drone
                    ? Icons.flight
                    : Icons.videocam,
              ),
      ),
    );
  }
}
