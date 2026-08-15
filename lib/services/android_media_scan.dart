import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:photo_manager/photo_manager.dart';

import 'folder_types.dart';

const _installerChannel = MethodChannel('medyaatlas/installer');

/// Native FileProvider ile APK kurulum ekranını aç (open_filex yerine).
Future<String?> installApkFile(String path) async {
  if (kIsWeb || !Platform.isAndroid) return 'Yalnızca Android.';
  try {
    final can = await _installerChannel.invokeMethod<bool>('canInstallPackages');
    if (can == false) {
      await _installerChannel.invokeMethod<void>('openInstallSettings');
      return 'Bilinmeyen uygulamalar iznini açıp tekrar Güncelle’ye basın.';
    }
    await _installerChannel.invokeMethod<void>('installApk', {'path': path});
    return null;
  } on PlatformException catch (e) {
    return e.message ?? 'Kurulum açılamadı (${e.code}).';
  } catch (e) {
    return 'Kurulum: $e';
  }
}

/// APK’yı uygulama dosya alanına indirmek için klasör.
Future<Directory> apkDownloadDirectory() async {
  if (Platform.isAndroid) {
    try {
      final ext = await getExternalStorageDirectory();
      if (ext != null) {
        final dir = Directory(p.join(ext.path, 'updates'));
        if (!await dir.exists()) await dir.create(recursive: true);
        return dir;
      }
    } catch (_) {}
  }
  final tmp = await getTemporaryDirectory();
  final dir = Directory(p.join(tmp.path, 'updates'));
  if (!await dir.exists()) await dir.create(recursive: true);
  return dir;
}

bool looksLikeApk(File file) {
  try {
    final raf = file.openSync();
    final magic = raf.readSync(4);
    raf.closeSync();
    // ZIP/APK: PK\x03\x04
    return magic.length == 4 &&
        magic[0] == 0x50 &&
        magic[1] == 0x4b &&
        magic[2] == 0x03 &&
        magic[3] == 0x04;
  } catch (_) {
    return false;
  }
}

/// Telefondaki tüm yerel foto/videoları MediaStore üzerinden tara.
Future<FolderPickResult> scanEntirePhoneMedia({
  int maxAssets = 8000,
  void Function(String status)? onProgress,
}) async {
  if (kIsWeb || !Platform.isAndroid) {
    throw UnsupportedError('Tüm telefon tarama yalnızca Android’de.');
  }

  final perm = await PhotoManager.requestPermissionExtend(
    requestOption: const PermissionRequestOption(
      androidPermission: AndroidPermission(
        type: RequestType.common,
        mediaLocation: true,
      ),
    ),
  );
  if (!perm.hasAccess) {
    throw StateError(
      'Medya izni yok. Ayarlar → MedyaAtlas → Fotoğraf/Video + medya konumu.',
    );
  }

  onProgress?.call('Telefon medyası listeleniyor…');
  final paths = await PhotoManager.getAssetPathList(
    type: RequestType.common,
    hasAll: true,
    onlyAll: true,
    filterOption: FilterOptionGroup(
      imageOption: const FilterOption(
        needTitle: true,
        sizeConstraint: SizeConstraint(ignoreSize: true),
      ),
      videoOption: const FilterOption(
        needTitle: true,
        sizeConstraint: SizeConstraint(ignoreSize: true),
      ),
      orders: [
        const OrderOption(type: OrderOptionType.createDate, asc: false),
      ],
    ),
  );
  if (paths.isEmpty) {
    return const FolderPickResult(folderName: 'Telefon (tümü)', items: []);
  }

  final album = paths.first;
  final total = await album.assetCountAsync;
  final end = total > maxAssets ? maxAssets : total;
  onProgress?.call('Telefon taranıyor: 0/$end…');

  final items = <FolderMediaRef>[];
  const page = 80;
  for (var start = 0; start < end; start += page) {
    final stop = math.min(start + page, end);
    final assets = await album.getAssetListRange(start: start, end: stop);
    for (final asset in assets) {
      if (asset.type != AssetType.image && asset.type != AssetType.video) {
        continue;
      }
      final name = _assetFileName(asset);
      final lat = asset.latitude;
      final lng = asset.longitude;
      final hasGps = lat != null &&
          lng != null &&
          lat.isFinite &&
          lng.isFinite &&
          !(lat == 0 && lng == 0);
      final id = asset.id;
      items.add(
        FolderMediaRef(
          name: name,
          size: 0,
          relativePath: 'phone/$id/$name',
          localPath: null,
          lastModified: asset.createDateTime,
          knownLat: hasGps ? lat : null,
          knownLng: hasGps ? lng : null,
          readHead: (maxBytes) => _readAssetHead(asset, maxBytes),
        ),
      );
    }
    onProgress?.call('Telefon taranıyor: ${items.length}/$end…');
  }

  return FolderPickResult(
    folderName: 'Telefon (tümü)',
    items: items,
  );
}

String _assetFileName(AssetEntity asset) {
  var title = (asset.title ?? '').trim();
  if (title.isEmpty) title = 'media_${asset.id}';
  if (isMediaName(title)) return title;
  final ext = asset.type == AssetType.video ? '.mp4' : '.jpg';
  if (title.contains('.')) return title;
  return '$title$ext';
}

Future<Uint8List> _readAssetHead(AssetEntity asset, int maxBytes) async {
  if (maxBytes <= 0) return Uint8List(0);
  try {
    final file = await asset.originFile ?? await asset.file;
    if (file == null) return Uint8List(0);
    final size = await file.length();
    final n = math.min(size, maxBytes);
    if (n <= 0) return Uint8List(0);
    final raf = await file.open();
    try {
      return await raf.read(n);
    } finally {
      await raf.close();
    }
  } catch (_) {
    return Uint8List(0);
  }
}
