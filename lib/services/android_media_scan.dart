import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:photo_manager/photo_manager.dart';

import 'folder_types.dart';
import 'geo.dart';

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

/// `phone/<assetId>/...` relativePath içinden MediaStore id’sini çıkar.
String? phoneAssetIdFromRelativePath(String? relativePath) {
  if (relativePath == null) return null;
  final parts = relativePath.split('/');
  if (parts.length >= 2 && parts[0] == 'phone' && parts[1].isNotEmpty) {
    return parts[1];
  }
  return null;
}

/// Telefondaki tüm yerel foto/videoları MediaStore üzerinden tara.
///
/// Android 10+: GPS için [AssetEntity.latlngAsync] gerekir (`latitude`
/// getter boş kalır). ACCESS_MEDIA_LOCATION + mediaLocation: true şart.
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
  var withGps = 0;
  const page = 40;
  for (var start = 0; start < end; start += page) {
    final stop = math.min(start + page, end);
    final assets = await album.getAssetListRange(start: start, end: stop);
    for (final asset in assets) {
      if (asset.type != AssetType.image && asset.type != AssetType.video) {
        continue;
      }
      final name = _assetFileName(asset);
      final id = asset.id;

      // Android 10+: senkron latitude her zaman null — async EXIF/MediaStore.
      double? knownLat;
      double? knownLng;
      try {
        final ll = await asset.latlngAsync();
        if (ll != null && isValidGps(ll.latitude, ll.longitude)) {
          knownLat = ll.latitude;
          knownLng = ll.longitude;
          withGps++;
        }
      } catch (_) {}

      String? localPath;
      var size = 0;
      try {
        final file = await asset.originFile ?? await asset.file;
        if (file != null) {
          localPath = file.path;
          size = await file.length();
        }
      } catch (_) {}

      items.add(
        FolderMediaRef(
          name: name,
          size: size,
          relativePath: 'phone/$id/$name',
          localPath: localPath,
          lastModified: asset.createDateTime,
          knownLat: knownLat,
          knownLng: knownLng,
          readHead: (maxBytes) => _readAssetHead(asset, maxBytes),
        ),
      );
    }
    onProgress?.call(
      'Telefon taranıyor: ${items.length}/$end · $withGps GPS…',
    );
  }

  return FolderPickResult(
    folderName: 'Telefon (tümü)',
    items: items,
  );
}

/// Kayıtlı MediaStore id’sinden GPS / dosya başlığı oku (yeniden dene).
Future<({double? lat, double? lng, Uint8List? head})> readPhoneAssetGps({
  required String assetId,
  required bool isPhoto,
  int headLimit = photoHeadBytes,
}) async {
  final asset = await AssetEntity.fromId(assetId);
  if (asset == null) {
    return (lat: null, lng: null, head: null);
  }
  double? lat;
  double? lng;
  try {
    final ll = await asset.latlngAsync();
    if (ll != null && isValidGps(ll.latitude, ll.longitude)) {
      lat = ll.latitude;
      lng = ll.longitude;
    }
  } catch (_) {}

  Uint8List? head;
  if (lat == null || isPhoto) {
    try {
      head = await _readAssetHead(asset, headLimit);
    } catch (_) {}
  }
  return (lat: lat, lng: lng, head: head);
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
  final limit = maxBytes <= 0 ? photoHeadBytes : maxBytes;
  try {
    final file = await asset.originFile ?? await asset.file;
    if (file == null) return Uint8List(0);
    final size = await file.length();
    final n = math.min(size, limit);
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

/// MediaStore / Photos ilk kare (veya küçük kapak) — grid önizleme için.
Future<Uint8List?> phoneAssetThumbnailBytes(
  String assetId, {
  int size = 360,
}) async {
  if (kIsWeb || !Platform.isAndroid) return null;
  try {
    final asset = await AssetEntity.fromId(assetId);
    if (asset == null) return null;
    return await asset.thumbnailDataWithSize(
      ThumbnailSize(size, size),
      quality: 80,
      frame: 0,
    );
  } catch (_) {
    return null;
  }
}
