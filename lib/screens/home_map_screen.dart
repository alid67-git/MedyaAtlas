import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';

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
import '../l10n/app_strings.dart';
import '../models/library_media.dart';
import '../repositories/media_repository.dart';
import '../services/android_media_scan.dart';
import '../services/app_settings.dart';
import '../services/app_updater.dart';
import '../services/cluster.dart';
import '../services/exif_gps.dart';
import '../services/folder_picker.dart';
import '../services/geo.dart';
import '../services/google_drive_media.dart';
import '../services/host_platform.dart';
import '../services/local_fs.dart';
import '../services/media_mime.dart';
import '../services/media_permissions.dart';
import '../services/place_search.dart';
import '../services/search_text.dart';
import '../services/video_gps.dart';
import '../services/video_preview.dart';
import '../services/web_object_url.dart';
import '../services/photo_orient.dart';
import '../widgets/cluster_dot.dart';
import '../widgets/drop_host.dart';
import '../widgets/media_viewer.dart';
import '../widgets/photo_map_pin.dart';
import '../widgets/photo_source.dart';
import '../widgets/video_surface.dart';
import '../services/media_groups.dart';
import 'settings_sheets.dart';
import 'package:permission_handler/permission_handler.dart';

const _worldCenter = LatLng(20, 0);

bool get _isDesktop => hostIsDesktop;

class HomeMapScreen extends StatefulWidget {
  const HomeMapScreen({super.key});

  @override
  State<HomeMapScreen> createState() => _HomeMapScreenState();
}

class _HomeMapScreenState extends State<HomeMapScreen>
    with WidgetsBindingObserver {
  final _map = MapController();
  final _picker = ImagePicker();
  bool _busy = false;
  bool _cancel = false;
  bool _dropping = false;
  bool _sourcesOpen = false;
  String? _kindMenu;
  String? _status;
  bool _showMissing = false;
  final _query = '';
  List<PlaceHit> _places = [];
  LocationCluster? _panelCluster;
  final Set<MediaKind> _kinds = {...MediaKind.values};
  Timer? _mountTimer;
  /// Zorunlu güncelleme — harita kullanılmaz.
  AppUpdateInfo? _forceUpdate;
  var _updateDialogOpen = false;

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
    WidgetsBinding.instance.addObserver(this);
    _mountTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!mounted || _busy) return;
      context.read<MediaRepository>().refreshMountStates();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _checkForUpdates();
      context.read<MediaRepository>().refreshMountStates();
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && mounted) {
      context.read<MediaRepository>().refreshMountStates();
      if (_forceUpdate != null && !_updateDialogOpen) {
        _promptUpdate(_forceUpdate!, force: true);
      } else {
        _checkForUpdates();
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _mountTimer?.cancel();
    super.dispose();
  }

  Future<void> _checkForUpdates({bool manual = false}) async {
    if (!supportsInAppUpdate) {
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
    if (!info.isNewer) {
      if (_forceUpdate != null) setState(() => _forceUpdate = null);
      if (manual) {
        setState(() => _status = 'Güncelsiniz: v$appVersion');
      }
      return;
    }
    final force = info.isForceRequired;
    if (force) {
      setState(() => _forceUpdate = info);
    } else if (_forceUpdate != null) {
      setState(() => _forceUpdate = null);
    }
    await _promptUpdate(info, force: force);
  }

  Future<void> _promptUpdate(
    AppUpdateInfo info, {
    required bool force,
  }) async {
    if (!mounted || _updateDialogOpen) return;
    _updateDialogOpen = true;
    try {
      final go = await showDialog<bool>(
        context: context,
        barrierDismissible: !force,
        builder: (ctx) => PopScope(
          canPop: !force,
          child: AlertDialog(
            title: Text(
              force
                  ? 'Zorunlu güncelleme: v${info.latestVersion}'
                  : 'Güncelleme var: v${info.latestVersion}',
            ),
            content: Text(force ? info.forceDialogBody : info.dialogBody),
            actions: [
              if (!force)
                TextButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text('Sonra'),
                ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: Text(
                  force
                      ? 'Güncelle'
                      : (info.platform == UpdatePlatform.web
                          ? 'Yenile'
                          : 'İndir'),
                ),
              ),
            ],
          ),
        ),
      );
      if (go == true && mounted) {
        await _downloadUpdate(info);
      } else if (force && mounted) {
        // Kullanıcı kapatamadı; yine de engeli tut.
        setState(() => _forceUpdate = info);
      }
    } finally {
      _updateDialogOpen = false;
    }
  }

  Future<void> _downloadUpdate(AppUpdateInfo info) async {
    if (info.platform == UpdatePlatform.web) {
      setState(() => _status = 'Sayfa yenileniyor…');
      final err = await downloadAndApplyUpdate(info);
      if (!mounted) return;
      if (err != null) setState(() => _status = err);
      return;
    }

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
        _status =
            'Kurulum ekranı açıldı — Güncelle’ye basın (silmeden üzerine kurar).';
      } else {
        _status =
            'v${info.latestVersion} indirildi. Bu uygulamayı kapatıp '
            'yeni medyaatlas.exe ile açın.';
      }
    });
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
    if (kIsWeb ||
        (defaultTargetPlatform != TargetPlatform.android &&
            defaultTargetPlatform != TargetPlatform.iOS)) {
      setState(
        () => _status =
            'Tüm telefon tarama yalnızca Android / iOS uygulamasında.',
      );
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
          if (mounted && !_cancel) setState(() => _status = s);
        },
      );
      if (!mounted) return;
      if (picked.items.isEmpty) {
        setState(() {
          _endBusy();
          _status = 'Telefonda foto/video bulunamadı.';
        });
        return;
      }
      await _ingestPick(picked, alreadyBusy: true, bulkMode: true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _endBusy();
        _status = 'Telefon tarama: $e';
      });
    }
  }

  Future<void> _importFavorites() async {
    if (kIsWeb) {
      // Diyalog / await YOK — Safari kullanıcı jestini kırıp dosyaları yutuyor.
      // Tip: çoklu seç moduna gir (videoyu oynatmadan işaretle).
      if (mounted) {
        setState(
          () => _status =
              'Favoriler: sağ üst «Seç» → işaretle (videoya dokun = seç) → Ekle',
        );
      }
      await _importWebPickedMedia(sourceLabel: 'Favoriler');
      return;
    }

    if (defaultTargetPlatform != TargetPlatform.android &&
        defaultTargetPlatform != TargetPlatform.iOS) {
      setState(
        () => _status = 'Favoriler yalnızca Android / iOS uygulamasında.',
      );
      return;
    }
    if (!await _ensureAndroidMediaAccess()) return;
    setState(() {
      _beginBusy();
      _status = 'Favoriler ekleniyor…';
    });
    try {
      final picked = await scanFavoritePhoneMedia(
        onProgress: (s) {
          if (mounted && !_cancel) setState(() => _status = s);
        },
      );
      if (!mounted) return;
      if (picked.items.isEmpty) {
        setState(() {
          _endBusy();
          _status = 'Favori medya bulunamadı.';
        });
        return;
      }
      await _ingestPick(picked, alreadyBusy: true, bulkMode: true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _endBusy();
        _status = 'Favoriler: $e';
      });
    }
  }

  /// Web galeri/favori: HTML file input (DOM’da). image_picker Safari’de boş döner.
  Future<void> _importWebPickedMedia({required String sourceLabel}) async {
    // input.click() bu çağrı zincirinde ilk await’ten önce olmalı.
    final future = pickMultipleMediaFiles();
    if (mounted) {
      setState(() {
        _beginBusy();
        _status ??= '$sourceLabel seçiliyor…';
      });
    }
    FolderPickResult? picked;
    try {
      picked = await future;
      if (!mounted) return;
      if (picked == null || picked.items.isEmpty) {
        setState(() {
          _endBusy();
          _status =
              'Medya gelmedi. Sağ üst «Seç» → işaretle → «Ekle» (videoyu açmadan).';
        });
        return;
      }
      final repo = context.read<MediaRepository>();
      final source = await repo.ensureSource(
        id: sourceLabel == 'Favoriler' ? 'favorites_web' : gallerySourceId,
        label: sourceLabel,
      );
      if (mounted) {
        setState(
          () => _status =
              '$sourceLabel: ${picked!.items.length} medya işleniyor…',
        );
      }
      await _ingest(picked.items, source: source);
    } catch (e) {
      if (!mounted) return;
      setState(() => _status = '$sourceLabel: $e');
    } finally {
      if (mounted) setState(_endBusy);
    }
  }

  Future<void> _importGallery() async {
    if (kIsWeb) {
      if (mounted) {
        setState(
          () => _status =
              'Sağ üst «Seç» → foto/videoyu işaretle (oynatma yok) → Ekle',
        );
      }
      await _importWebPickedMedia(sourceLabel: 'Galeri');
      return;
    }
    if (!await _ensureAndroidMediaAccess()) return;
    setState(() {
      _beginBusy();
      _status = null;
    });
    try {
      final files = await _picker.pickMultipleMedia();
      if (!mounted) return;
      if (files.isEmpty) {
        setState(() {
          _endBusy();
          _status = 'Medya seçilmedi.';
        });
        return;
      }
      final refs = <FolderMediaRef>[];
      for (final file in files) {
        final size = await file.length();
        final path = file.path.isEmpty ? null : file.path;
        refs.add(
          FolderMediaRef(
            name: file.name,
            size: size,
            relativePath: file.name,
            localPath: path,
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
        (!hasGoogleServerClientId && hostIsAndroid)) {
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
      setState(() {
        _beginBusy();
        _status = 'Klasör listeleniyor…';
      });
      picked = await pickMediaFolder(
        onProgress: (n, _) {
          if (mounted && !_cancel) {
            setState(() => _status = 'Klasör taranıyor… $n medya');
          }
        },
        isCancelled: () => _cancel,
      );
      if (_cancel && mounted) {
        if (picked == null || picked.items.isEmpty) {
          setState(() {
            _endBusy();
            _status = 'Tarama iptal edildi.';
          });
          return;
        }
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _endBusy();
        _status = 'Klasör açılamadı: $e';
      });
      return;
    }
    if (!mounted) return;
    if (picked == null) {
      setState(_endBusy);
      return;
    }
    await _ingestPick(picked, alreadyBusy: true);
  }

  Future<void> _importExternalVolume() async {
    if (!await _ensureAndroidMediaAccess()) return;
    FolderPickResult? picked;
    try {
      setState(() {
        _beginBusy();
        _status = 'Disk listeleniyor…';
      });
      picked = await pickExternalVolume(
        onProgress: (n, _) {
          if (mounted && !_cancel) {
            setState(() => _status = 'Disk taranıyor… $n medya bulundu');
          }
        },
        isCancelled: () => _cancel,
      );
      if (_cancel && mounted) {
        if (picked == null || picked.items.isEmpty) {
          setState(() {
            _endBusy();
            _status = 'Tarama iptal edildi.';
          });
          return;
        }
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _endBusy();
        final msg = '$e';
        _status = msg.contains('Permission denied') ||
                msg.contains('PathAccessException')
            ? 'Disk tarandı ama bazı klasörler kapalı (Android/data). '
                'DCIM veya kart kökünü tekrar seçin; izinli klasörler okunur.'
            : 'Disk açılamadı: $e';
      });
      return;
    }
    if (!mounted) return;
    if (picked == null) {
      setState(_endBusy);
      return;
    }
    await _ingestPick(picked, alreadyBusy: true, bulkMode: true);
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
          readHead: (maxBytes) => readLocalFileHead(path, maxBytes),
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

  Future<void> _ingestPick(
    FolderPickResult result, {
    bool alreadyBusy = false,
    bool? bulkMode,
  }) async {
    if (result.items.isEmpty) {
      setState(() {
        if (alreadyBusy) _endBusy();
        _status = '"${result.folderName}" içinde foto/video bulunamadı.';
      });
      return;
    }
    final videoCount = result.items.where((f) => f.isVideo).length;
    final photoCount = result.items.length - videoCount;
    final bulk = bulkMode ?? result.rootPath != null;
    setState(() {
      if (!alreadyBusy) _beginBusy();
      _status =
          '"${result.folderName}" okunuyor… ($photoCount foto · $videoCount video)'
          '${bulk ? ' · hızlı tarama' : ''}';
    });
    try {
      final repo = context.read<MediaRepository>();
      final source = await repo.ensureSource(
        label: result.folderName,
        rootPath: result.rootPath,
      );
      await _ingest(result.items, source: source, bulkMode: bulk);
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
      if (localIsDirectorySync(path)) {
        setState(() {
          _beginBusy();
          _status = 'Klasör listeleniyor…';
        });
        try {
          final result = await scanMediaDirectory(
            path,
            onProgress: (n, _) {
              if (mounted && !_cancel) {
                setState(() => _status = 'Klasör taranıyor… $n medya');
              }
            },
            isCancelled: () => _cancel,
          );
          if (!mounted) return;
          if (_cancel && result.items.isEmpty) {
            setState(() {
              _endBusy();
              _status = 'Tarama iptal edildi.';
            });
            return;
          }
          await _ingestPick(result, alreadyBusy: true);
        } catch (e) {
          if (mounted) {
            setState(() {
              _endBusy();
              _status = 'Klasör okunamadı: $e';
            });
          }
        }
      } else if (localIsFileSync(path) && isMediaName(p.basename(path))) {
        final size = await localFileLength(path);
        final name = p.basename(path);
        loose.add(
          FolderMediaRef(
            name: name,
            size: size,
            relativePath: name,
            localPath: path,
            lastModified: await localFileModified(path),
            readHead: (maxBytes) => readLocalFileHead(path, maxBytes),
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
    bool bulkMode = false,
  }) async {
    final repo = context.read<MediaRepository>();
    var withGps = 0;
    var added = 0;
    var missing = 0;
    var failed = 0;
    final kindCounts = {for (final k in MediaKind.values) k: 0};
    final photoLimit = bulkMode ? bulkPhotoHeadBytes : photoHeadBytes;
    final videoLimitGeneric = bulkMode ? bulkVideoHeadBytes : videoHeadBytes;
    final videoLimitGps = bulkMode ? bulkGpsVideoHeadBytes : videoHeadBytes;
    final progressEvery = bulkMode ? 40 : 8;
    final persistEvery = bulkMode ? 64 : 8;
    final yieldEvery = bulkMode ? 20 : 8;

    // Tür filtresi yalnızca harita/liste görünümünü etkiler — tarama her
    // zaman foto + video + GoPro + drone ekler.
    for (var i = 0; i < files.length; i++) {
      if (_cancel) break;
      final file = files[i];
      if (mounted && i % progressEvery == 0) {
        setState(
          () => _status =
              '${source.label}: ${i + 1}/${files.length} · $withGps GPS · $missing yok · ${kindCountsLabel(kindCounts)}',
        );
      }
      if (i % yieldEvery == 0) {
        await Future<void>.delayed(Duration.zero);
      }
      final kind = detectKind(file.name) ??
          (file.isVideo ? MediaKind.video : MediaKind.photo);
      final needsDeepGps =
          kind == MediaKind.gopro || kind == MediaKind.drone;
      final videoLimit = needsDeepGps ? videoLimitGps : videoLimitGeneric;
      final rel = file.relativePath ?? file.name;
      final ephemeralWeb = kIsWeb ||
          file.localPath == null ||
          file.localPath!.isEmpty ||
          isWebPlayableUrl(file.localPath);
      try {
        final existing = repo.findByIndex(
          sourceId: source.id,
          relativePath: rel,
          size: file.size,
        );
        if (existing != null) {
          var located = existing.hasLocation;
          // Web: eski kayıtta bayt/blob yoksa aynı dosyadan doldur.
          if (ephemeralWeb && !bulkMode) {
            final hasPreview = repo.cachedBytes(existing.id) != null ||
                await repo.bytesOf(existing.id) != null;
            if (existing.isVideo) {
              if (!hasPreview) {
                Uint8List? head;
                try {
                  head = await file.readHead(videoLimit);
                } catch (_) {}
                final preview = await extractVideoPreviewBytes(
                  localPath: file.localPath,
                  relativePath: file.relativePath,
                  head: head,
                );
                if (preview != null) {
                  await repo.putPreviewBytes(existing.id, preview);
                }
              }
              final hasPayload = await repo.payloadOf(existing.id) != null;
              if (!hasPayload &&
                  file.size > 0 &&
                  file.size <= webStoreVideoBytes) {
                try {
                  final payload = await file.readHead(file.size);
                  await repo.putPayloadBytes(existing.id, payload);
                  final url = createObjectUrlFromBytes(
                    payload,
                    mimeFromName(file.name),
                  );
                  if (url != null) {
                    await repo.updateLocalPath(
                      id: existing.id,
                      localPath: url,
                      persist: false,
                    );
                  }
                } catch (_) {}
              } else if (isWebPlayableUrl(file.localPath) &&
                  existing.localPath != file.localPath) {
                await repo.updateLocalPath(
                  id: existing.id,
                  localPath: file.localPath,
                  persist: false,
                );
              }
              if (!located) {
                Uint8List? head;
                try {
                  head = await file.readHead(videoLimit);
                } catch (_) {}
                final gps = await extractVideoGps(
                  localPath: file.localPath,
                  head: head,
                  relativePath: file.relativePath,
                  deepScan: needsDeepGps,
                  maxScanBytes: needsDeepGps ? videoLimitGps : videoGpsScanBytes,
                );
                if (gps != null) {
                  await repo.updateLocation(
                    id: existing.id,
                    lat: gps.latitude,
                    lng: gps.longitude,
                    persist: false,
                    notify: false,
                  );
                  located = true;
                }
              }
            } else if (file.size > 0) {
              try {
                final bytes = (!hasPreview || !located)
                    ? await file.readHead(
                        math.min(file.size, webStorePhotoBytes),
                      )
                    : null;
                if (bytes != null && bytes.isNotEmpty) {
                  if (!hasPreview) {
                    await repo.putPreviewBytes(existing.id, bytes);
                  }
                  if (!located) {
                    final gps = await extractExifGps(bytes);
                    final taken = await extractExifTakenAt(bytes);
                    if (gps != null) {
                      await repo.updateLocation(
                        id: existing.id,
                        lat: gps.latitude,
                        lng: gps.longitude,
                        takenAt: taken,
                        persist: false,
                        notify: false,
                      );
                      located = true;
                    }
                  }
                }
              } catch (_) {}
            }
          } else if (!bulkMode && existing.isVideo) {
            final hasPreview = repo.cachedBytes(existing.id) != null ||
                await repo.bytesOf(existing.id) != null;
            if (!hasPreview) {
              Uint8List? head;
              try {
                head = await file.readHead(videoLimit);
              } catch (_) {}
              final preview = await extractVideoPreviewBytes(
                localPath: file.localPath,
                relativePath: file.relativePath,
                head: head,
              );
              if (preview != null) {
                await repo.putPreviewBytes(existing.id, preview);
              }
            }
          }
          added++;
          kindCounts[existing.kind] = (kindCounts[existing.kind] ?? 0) + 1;
          if (located) {
            withGps++;
          } else {
            missing++;
          }
          continue;
        }
        final isPhoto = kind == MediaKind.photo;
        // Web / blob: disk yolu yok — tam bayt veya blob URL gerekir.
        final ephemeral = kIsWeb ||
            file.localPath == null ||
            file.localPath!.isEmpty ||
            isWebPlayableUrl(file.localPath);
        final headLimit = isPhoto
            ? (ephemeral && file.size > 0
                ? math.min(file.size, webStorePhotoBytes)
                : (file.size <= 0
                    ? photoLimit
                    : (file.size <= previewStoreBytes
                        ? file.size
                        : photoLimit)))
            : videoLimit;

        LatLng? gps;
        DateTime? taken = file.lastModified;
        if (file.knownLat != null && file.knownLng != null) {
          gps = latLngOrNull(file.knownLat, file.knownLng);
        }

        Uint8List? head;
        final needHead = gps == null ||
            (isPhoto && ephemeral && file.size > 0) ||
            (!bulkMode &&
                isPhoto &&
                file.size > 0 &&
                file.size <= previewStoreBytes);
        if (needHead) {
          try {
            final limit = gps != null &&
                    isPhoto &&
                    file.size > 0 &&
                    !bulkMode &&
                    !ephemeral
                ? file.size
                : headLimit;
            head = await file.readHead(limit);
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
              gps = await extractVideoGps(
                localPath: file.localPath,
                head: head,
                relativePath: file.relativePath,
                // GoPro/DJI: toplu taramada da GPMF / derin head.
                deepScan: !bulkMode || needsDeepGps,
                maxScanBytes: needsDeepGps ? videoLimitGps : videoGpsScanBytes,
              );
            }
          } catch (_) {
            // GPS okunamasa da dosya kütüphaneye girer.
          }
        } else if (gps == null && !isPhoto) {
          try {
            gps = await extractVideoGps(
              localPath: file.localPath,
              head: head,
              relativePath: file.relativePath,
              deepScan: !bulkMode || needsDeepGps,
              maxScanBytes: needsDeepGps ? videoLimitGps : videoGpsScanBytes,
            );
          } catch (_) {}
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
        // Toplu tarama: video önizlemeyi sonraya bırak (ızgara VideoThumb).
        // Web foto: boyuttan bağımsız (üst sınır webStorePhotoBytes) sakla.
        final preview = bulkMode
            ? null
            : (isPhoto
                ? (head != null &&
                        head.isNotEmpty &&
                        (ephemeral || file.size <= previewStoreBytes)
                    ? head
                    : null)
                : await extractVideoPreviewBytes(
                    localPath: file.localPath,
                    relativePath: file.relativePath,
                    head: head,
                  ));

        var localPath = file.localPath;
        Uint8List? videoPayload;
        if (!isPhoto && ephemeral && kIsWeb) {
          if (!isWebPlayableUrl(localPath)) {
            localPath = null;
          }
          // Orta boy videoları Hive’a yaz — sayfa yenilenince blob URL ölür.
          if (file.size > 0 && file.size <= webStoreVideoBytes) {
            try {
              videoPayload = head != null && head.length >= file.size
                  ? head
                  : await file.readHead(file.size);
              localPath ??= createObjectUrlFromBytes(
                videoPayload,
                mimeFromName(file.name),
              );
            } catch (_) {
              videoPayload = null;
            }
          }
        }

        final media = await repo.add(
          name: file.name,
          kind: kind,
          sourceId: source.id,
          bytes: preview,
          relativePath: rel,
          localPath: localPath,
          sizeBytes: file.size,
          lat: gps?.latitude,
          lng: gps?.longitude,
          takenAt: taken,
          persist: i == files.length - 1 || i % persistEvery == persistEvery - 1,
          // Tarama bitene kadar haritayı yenileme — NaN pin anında çökertmesin.
          notify: false,
        );
        if (videoPayload != null && videoPayload.isNotEmpty) {
          await repo.putPayloadBytes(media.id, videoPayload);
        }
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
    final tip = bulkMode && missing > 0
        ? ' · GPS eksikler için “yeniden dene”'
        : (kIsWeb && missing > 0
            ? ' · iPhone foto GPS’i gizleyebilir; GoPro/DJI için yeniden seçin'
            : '');
    setState(() {
      _showMissing = false;
      _panelCluster = null;
      // Yeni eklenen türler haritada görünsün diye filtreyi aç.
      _kinds.addAll(MediaKind.values);
      _status = _cancel
          ? 'Tarama durdu: $added medya ($kindsText) · $withGps GPS · $missing konum yok$failText$tip'
          : '"${source.label}": $added medya ($kindsText) · $withGps GPS · $missing konum yok$failText$tip';
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
          if (phoneId != null && hostIsAndroid) {
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
                  : await extractVideoGps(
                      localPath: item.localPath,
                      head: got.head,
                      relativePath: item.relativePath,
                    );
              if (item.kind == MediaKind.photo) {
                taken = await extractExifTakenAt(got.head!);
              }
            } else if (gps == null && item.kind != MediaKind.photo) {
              gps = await extractVideoGps(
                localPath: item.localPath,
                relativePath: item.relativePath,
              );
            }
          } else {
            Uint8List? head;
            final path = item.localPath;
            if (path != null &&
                path.isNotEmpty &&
                await localFileExists(path)) {
              final size = await localFileLength(path);
              final limit = item.kind == MediaKind.photo
                  ? (size <= 0
                      ? photoHeadBytes
                      : (size <= previewStoreBytes ? size : photoHeadBytes))
                  : videoHeadBytes;
              if (size > 0 && limit > 0) {
                head = await readLocalFileHead(path, limit);
              }
            } else {
              head = await repo.bytesOf(item.id);
            }
            if (head == null || head.isEmpty) {
              if (item.kind == MediaKind.photo) continue;
              checked++;
              gps = await extractVideoGps(
                localPath: item.localPath,
                relativePath: item.relativePath,
              );
              if (gps == null) continue;
            } else {
              checked++;
              gps = item.kind == MediaKind.photo
                  ? await extractExifGps(head)
                  : await extractVideoGps(
                      localPath: item.localPath,
                      head: head,
                      relativePath: item.relativePath,
                    );
              if (item.kind == MediaKind.photo) {
                taken = await extractExifTakenAt(head);
              }
            }
            if (gps == null) continue;
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
    setState(() {
      _panelCluster = cluster;
      _showMissing = false;
      _sourcesOpen = false;
      _kindMenu = null;
    });
    if (_isDesktop || MediaQuery.sizeOf(context).width >= 960) {
      return;
    }
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: const Color(0xFF0A1C28),
      builder: (ctx) {
        final live = ctx.watch<MediaRepository>();
        final h = MediaQuery.sizeOf(ctx).height * 0.62;
        return SizedBox(
          height: h.clamp(320.0, 640.0),
          child: _ClusterSheet(
            cluster: cluster,
            repo: live,
            onOpen: (items, index) {
              Navigator.pop(ctx);
              openMediaViewer(
                context,
                items: items,
                initialIndex: index,
              );
            },
          ),
        );
      },
    );
    if (mounted) setState(() => _panelCluster = null);
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
    final settings = context.watch<AppSettings>();
    final s = S.of(settings);
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
                      Expanded(child: _buildMain(clusters, missing, repo)),
                      if (wide && _panelCluster != null) ...[
                        const VerticalDivider(width: 1),
                        SizedBox(
                          width: 360,
                          child: _ClusterSheet(
                            cluster: _panelCluster!,
                            repo: repo,
                            onClose: () =>
                                setState(() => _panelCluster = null),
                            onOpen: (items, index) => openMediaViewer(
                              context,
                              items: items,
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
                        s: s,
                        settings: settings,
                        hasPins: clusters.isNotEmpty,
                        locatedCount: locatedCount,
                        missingCount: missing.length,
                        sourceCount: sourceCount,
                      ),
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

    return wrapDropTarget(
      onDragging: (v) => setState(() => _dropping = v),
      onDrop: _onDrop,
      child: Stack(
        children: [
          body,
          if (_dropping)
            ColoredBox(
              color: const Color(0x88000000),
              child: Center(
                child: Text(
                  s.dropHint,
                  style: const TextStyle(fontSize: 20, color: Colors.white),
                ),
              ),
            ),
          if (_forceUpdate != null)
            Positioned.fill(
              child: Material(
                color: const Color(0xF0050E16),
                child: SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(
                          Icons.system_update_alt,
                          size: 56,
                          color: Color(0xFF2EC4B6),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'Zorunlu güncelleme',
                          style: Theme.of(context).textTheme.headlineSmall,
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 12),
                        Text(
                          _forceUpdate!.forceDialogBody,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.85),
                            height: 1.4,
                          ),
                        ),
                        const SizedBox(height: 24),
                        FilledButton.icon(
                          onPressed: _updateDialogOpen
                              ? null
                              : () => _promptUpdate(
                                    _forceUpdate!,
                                    force: true,
                                  ),
                          icon: const Icon(Icons.download),
                          label: Text('v${_forceUpdate!.latestVersion} güncelle'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _mapTopBar({
    required S s,
    required AppSettings settings,
    required bool hasPins,
    required int locatedCount,
    required int missingCount,
    required String sourceCount,
  }) {
    return Material(
      color: const Color(0xE0050E16),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 6, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text.rich(
                    TextSpan(
                      text: s.appName,
                      style: const TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w700,
                        height: 1.05,
                        letterSpacing: -0.4,
                      ),
                      children: [
                        TextSpan(
                          text: '  v$appVersion',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: Colors.white.withValues(alpha: 0.55),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                _TopIcon(
                  tooltip: s.settings,
                  icon: Icons.settings_outlined,
                  onPressed: _busy
                      ? null
                      : () => openSettingsSheet(
                            context,
                            onCheckUpdate: supportsInAppUpdate
                                ? () => _checkForUpdates(manual: true)
                                : null,
                          ),
                ),
              ],
            ),
            const SizedBox(height: 2),
            Text(
              '${s.developedBy}: $appDeveloperName',
              style: TextStyle(
                fontSize: 13,
                color: Colors.white.withValues(alpha: 0.55),
              ),
            ),
            if (!_busy) ...[
              const SizedBox(height: 6),
              Row(
                children: [
                  _TopIcon(
                    tooltip: s.sources,
                    selected: _sourcesOpen,
                    icon: Icons.folder_outlined,
                    badge: sourceCount,
                    onPressed: () => setState(() {
                      _sourcesOpen = !_sourcesOpen;
                      if (_sourcesOpen) _kindMenu = null;
                    }),
                  ),
                  _TopIcon(
                    tooltip: s.gpsLocated,
                    selected: !_showMissing && _kindMenu == 'located',
                    icon: Icons.location_on_outlined,
                    badge: '$locatedCount',
                    onPressed: () => setState(() {
                      _showMissing = false;
                      _panelCluster = null;
                      _sourcesOpen = false;
                      _kindMenu = _kindMenu == 'located' ? null : 'located';
                    }),
                  ),
                  _TopIcon(
                    tooltip: s.noLocation,
                    selected: _showMissing,
                    icon: Icons.location_off_outlined,
                    badge: '$missingCount',
                    onPressed: () => setState(() {
                      _showMissing = true;
                      _panelCluster = null;
                      _sourcesOpen = false;
                      _kindMenu = _kindMenu == 'missing' ? null : 'missing';
                    }),
                  ),
                  _TopIcon(
                    tooltip: s.mapLayers,
                    icon: Icons.layers_outlined,
                    onPressed: () => openMapLayerSheet(context),
                  ),
                  _TopIcon(
                    tooltip: s.fitAll,
                    icon: Icons.zoom_out_map,
                    onPressed: hasPins ? _fitVisible : null,
                  ),
                  _TopIcon(
                    tooltip: s.help,
                    icon: Icons.help_outline,
                    onPressed: () => openHelpSheet(context),
                  ),
                ],
              ),
            ],
          ],
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
    final s = S.of(context.watch<AppSettings>());
    final text = _busy
        ? (_status ?? 'Dosyalar aranıyor…')
        : (_status ??
            _libraryStatus(
              repo: repo,
              visible: visible,
              clusterCount: clusterCount,
              missingCount: missingCount,
            ));
    return Material(
      elevation: 8,
      color: const Color(0xF00A1C28),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(
          color: _busy
              ? const Color(0xFF2EC4B6)
              : Colors.white.withValues(alpha: 0.22),
          width: _busy ? 1.5 : 1,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
        child: Row(
          children: [
            if (_busy) ...[
              const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(
                  strokeWidth: 2.2,
                  color: Color(0xFF2EC4B6),
                ),
              ),
              const SizedBox(width: 10),
            ],
            Expanded(
              child: Text(
                text,
                style: TextStyle(
                  fontSize: 13,
                  height: 1.25,
                  color: Colors.white.withValues(alpha: _busy ? 0.95 : 0.88),
                ),
              ),
            ),
            if (_busy)
              TextButton(
                onPressed: () => setState(() {
                  _cancel = true;
                  _status = 'İptal ediliyor…';
                }),
                style: TextButton.styleFrom(
                  foregroundColor: const Color(0xFFFF7A59),
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  minimumSize: const Size(56, 36),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: Text(s.cancel),
              )
            else if (_status != null)
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
                !repo.isSourceMounted(source)
                    ? Icons.usb_off_outlined
                    : source.hidden
                        ? Icons.visibility_off_outlined
                        : Icons.visibility_outlined,
              ),
              title: Text(source.label, overflow: TextOverflow.ellipsis),
              subtitle: Text(
                [
                  '${repo.items.where((m) => m.sourceId == source.id).length} medya',
                  if (source.isRemovableVolume)
                    repo.isSourceMounted(source)
                        ? 'disk bağlı'
                        : 'disk çıkarıldı — pinler gizli',
                ].join(' · '),
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
                        _importExternalVolume();
                      },
                child: Text(
                  _isDesktop ? '+ Disk / SD' : '+ SD / USB disk',
                ),
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
              if (!_isDesktop && !kIsWeb)
                FilledButton.tonal(
                  onPressed: _busy
                      ? null
                      : () {
                          setState(_closeMenus);
                          _importEntirePhone();
                        },
                  child: const Text('+ Tüm telefon'),
                ),
              FilledButton.tonal(
                onPressed: _busy
                    ? null
                    : () {
                        setState(_closeMenus);
                        _importFavorites();
                      },
                child: Text(
                  kIsWeb ? '+ Favoriler (Seç→Ekle)' : '+ Favoriler (tümü)',
                ),
              ),
              if (!_isDesktop || kIsWeb)
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
            located
                ? S.of(context.watch<AppSettings>()).gpsLocated
                : S.of(context.watch<AppSettings>()).noLocation,
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
              label: Text(S.of(context.read<AppSettings>()).retryMissing),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildMain(
    List<LocationCluster> clusters,
    List<LibraryMedia> missing,
    MediaRepository repo,
  ) {
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
                    urlTemplate: context.watch<AppSettings>().mapUrlTemplate,
                    userAgentPackageName: 'com.medyaatlas.app',
                  ),
                  MarkerLayer(
                    markers: _markersFor(clusters, repo),
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

  List<Marker> _markersFor(
    List<LocationCluster> clusters,
    MediaRepository repo,
  ) {
    final out = <Marker>[];
    final selectedId = _panelCluster?.id;
    for (final cluster in clusters) {
      final lat = cluster.latitude;
      final lng = cluster.longitude;
      if (!lat.isFinite || !lng.isFinite) continue;
      if (lat.abs() > 90 || lng.abs() > 180) continue;
      final selected = cluster.id == selectedId;
      if (selected) {
        out.add(
          Marker(
            point: LatLng(lat, lng),
            width: 64,
            height: 76,
            alignment: Alignment.bottomCenter,
            child: GestureDetector(
              onTap: () => _openCluster(cluster),
              child: PhotoMapPin(
                item: coverMediaOf(cluster.items),
                repo: repo,
                count: cluster.items.length,
              ),
            ),
          ),
        );
      } else {
        final n = cluster.items.length;
        final size =
            math.min(88.0, 36 + math.sqrt(n.clamp(1, 200).toDouble()) * 9);
        out.add(
          Marker(
            point: LatLng(lat, lng),
            width: size,
            height: size,
            child: GestureDetector(
              onTap: () => _openCluster(cluster),
              behavior: HitTestBehavior.opaque,
              child: HeatBlob(count: n),
            ),
          ),
        );
      }
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
  final void Function(List<LibraryMedia> items, int index) onOpen;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final items = cluster.items;
    final groups = groupMediaByDay(items);
    final range = mediaDateRangeLabel(items);
    // Düz indeks: tüm öğeler yeniden eskiye (gruplarla aynı sıra).
    final flat = [for (final g in groups) ...g.items];

    return ColoredBox(
      color: const Color(0xFF0A1C28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 8, 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        mediaCountLabel(items),
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w700,
                          height: 1.15,
                        ),
                      ),
                      if (range != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          range,
                          style: TextStyle(
                            fontSize: 14,
                            color: Colors.white.withValues(alpha: 0.6),
                          ),
                        ),
                      ],
                    ],
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
          ),
          const Divider(height: 1),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 16),
              itemCount: groups.length,
              itemBuilder: (context, gi) {
                final g = groups[gi];
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Padding(
                      padding: EdgeInsets.fromLTRB(4, gi == 0 ? 4 : 14, 4, 8),
                      child: Text(
                        g.title,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: Colors.white.withValues(alpha: 0.85),
                        ),
                      ),
                    ),
                    GridView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      gridDelegate:
                          const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 3,
                        mainAxisSpacing: 6,
                        crossAxisSpacing: 6,
                      ),
                      itemCount: g.items.length,
                      itemBuilder: (context, i) {
                        final item = g.items[i];
                        final flatIndex = flat.indexOf(item);
                        return GestureDetector(
                          onTap: () => onOpen(flat, flatIndex < 0 ? 0 : flatIndex),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(6),
                            child: _Thumb(item: item, repo: repo),
                          ),
                        );
                      },
                    ),
                  ],
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
    if (cached != null && cached.isNotEmpty && looksLikeJpeg(cached)) {
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
      relativePath: widget.item.relativePath,
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
          Image.memory(
            bytes,
            fit: BoxFit.cover,
            gaplessPlayback: true,
            errorBuilder: (_, error, stack) => VideoThumb(
              path: widget.item.localPath,
              kind: widget.item.kind,
              resolveUrl: () =>
                  widget.repo.resolvePlayableUrl(widget.item),
            ),
          ),
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
    if (_loading) {
      return const ColoredBox(
        color: Colors.black26,
        child: Center(
          child: SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    }
    // Önbellek yoksa video oynatıcı ile ilk kareyi göster.
    return VideoThumb(
      path: widget.item.localPath,
      kind: widget.item.kind,
      resolveUrl: () => widget.repo.resolvePlayableUrl(widget.item),
    );
  }
}
