import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:photo_manager/photo_manager.dart';

import 'folder_types.dart';
import 'geo.dart';
import '../models/library_media.dart' show phoneRelativePath;

export '../models/library_media.dart'
    show phoneAssetIdFromRelativePath, phoneRelativePath;

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

bool looksLikeApk(Object file) {
  if (file is! File) return false;
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

/// `phone/<assetId>` relativePath — başlık indekse girmez (yeniden tara çift eklemesin).

/// Telefondaki tüm yerel foto/videoları MediaStore / Photos üzerinden tara.
///
/// Android 10+: GPS için [AssetEntity.latlngAsync] gerekir (`latitude`
/// getter boş kalır). ACCESS_MEDIA_LOCATION + mediaLocation: true şart.
Future<FolderPickResult> scanEntirePhoneMedia({
  int maxAssets = 8000,
  void Function(String status)? onProgress,
}) async {
  await _ensurePhoneMediaPermission();
  onProgress?.call('Telefon medyası listeleniyor…');
  final album = await _allPhotosAlbum();
  if (album == null) {
    return const FolderPickResult(folderName: 'Tüm telefon', items: []);
  }
  return _scanAlbumAssets(
    album,
    folderName: 'Tüm telefon',
    maxAssets: maxAssets,
    onProgress: onProgress,
  );
}

/// Favoriler albümünün tamamı (iOS Smart Album / Android isFavorite).
Future<FolderPickResult> scanFavoritePhoneMedia({
  int maxAssets = 8000,
  void Function(String status)? onProgress,
}) async {
  await _ensurePhoneMediaPermission();
  onProgress?.call('Favoriler aranıyor…');

  final filter = _phoneFilter();
  final paths = await PhotoManager.getAssetPathList(
    type: RequestType.common,
    hasAll: false,
    onlyAll: false,
    filterOption: filter,
  );

  AssetPathEntity? favorites;
  for (final path in paths) {
    if (path.albumTypeEx?.darwin?.subtype ==
        PMDarwinAssetCollectionSubtype.smartAlbumFavorites) {
      favorites = path;
      break;
    }
    final name = path.name.toLowerCase().trim();
    if (name == 'favorites' ||
        name == 'favourites' ||
        name == 'favoriler' ||
        name == 'favorilerim' ||
        name == 'favori' ||
        name.contains('favorite') ||
        name.contains('favourit') ||
        name.contains('favori')) {
      favorites = path;
      break;
    }
  }

  if (favorites != null) {
    return _scanAlbumAssets(
      favorites,
      folderName: 'Favoriler',
      maxAssets: maxAssets,
      onProgress: onProgress,
    );
  }

  // Albüm bulunamazsa: tüm kütüphanede isFavorite bayrağı.
  onProgress?.call('Favori işareti taranıyor…');
  final all = await _allPhotosAlbum();
  if (all == null) {
    return const FolderPickResult(folderName: 'Favoriler', items: []);
  }
  return _scanAlbumAssets(
    all,
    folderName: 'Favoriler',
    maxAssets: maxAssets,
    onProgress: onProgress,
    onlyFavorites: true,
  );
}

FilterOptionGroup _phoneFilter() => FilterOptionGroup(
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
    );

Future<void> _ensurePhoneMediaPermission() async {
  if (kIsWeb || !(Platform.isAndroid || Platform.isIOS)) {
    throw UnsupportedError('Telefon tarama yalnızca Android / iOS uygulamasında.');
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
}

Future<AssetPathEntity?> _allPhotosAlbum() async {
  final paths = await PhotoManager.getAssetPathList(
    type: RequestType.common,
    hasAll: true,
    onlyAll: true,
    filterOption: _phoneFilter(),
  );
  if (paths.isEmpty) return null;
  return paths.first;
}

Future<FolderPickResult> _scanAlbumAssets(
  AssetPathEntity album, {
  required String folderName,
  int maxAssets = 8000,
  void Function(String status)? onProgress,
  bool onlyFavorites = false,
}) async {
  final total = await album.assetCountAsync;
  final end = total > maxAssets ? maxAssets : total;
  onProgress?.call('$folderName: 0/$end…');

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
      if (onlyFavorites && !asset.isFavorite) continue;

      final name = _assetFileName(asset);
      final id = asset.id;

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
          relativePath: phoneRelativePath(id),
          localPath: localPath,
          lastModified: asset.createDateTime,
          knownLat: knownLat,
          knownLng: knownLng,
          readHead: (maxBytes) => _readAssetHead(asset, maxBytes),
        ),
      );
    }
    onProgress?.call(
      '$folderName: ${items.length}/$end · $withGps GPS…',
    );
  }

  return FolderPickResult(
    folderName: folderName,
    items: items,
  );
}

/// Kayıtlı MediaStore id’sinden GPS / dosya başlığı oku (yeniden dene).
Future<({double? lat, double? lng, Uint8List? head})> readPhoneAssetGps({
  required String assetId,
  required bool isPhoto,
  int headLimit = photoHeadBytes,
}) async {
  final deep = await readPhoneAssetGpsDeep(
    assetId: assetId,
    isPhoto: isPhoto,
    headLimit: headLimit,
    tailLimit: 0,
  );
  return (lat: deep.lat, lng: deep.lng, head: deep.head);
}

/// GoPro/DJI yeniden dene: taze dosya yolu + baş + kuyruk.
Future<
    ({
      double? lat,
      double? lng,
      String? path,
      Uint8List? head,
      Uint8List? tail,
    })> readPhoneAssetGpsDeep({
  required String assetId,
  required bool isPhoto,
  int headLimit = photoHeadBytes,
  int tailLimit = 0,
}) async {
  final asset = await AssetEntity.fromId(assetId);
  if (asset == null) {
    return (lat: null, lng: null, path: null, head: null, tail: null);
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

  String? path;
  Uint8List? head;
  Uint8List? tail;
  try {
    final file = await asset.originFile ?? await asset.file;
    if (file != null) {
      path = file.path;
      final size = await file.length();
      if (lat == null || isPhoto || headLimit > 0) {
        final n = math.min(size, headLimit <= 0 ? photoHeadBytes : headLimit);
        if (n > 0) {
          head = await _readFileRange(file, 0, n);
        }
      }
      if (lat == null && !isPhoto && tailLimit > 0 && size > 0) {
        final n = math.min(size, tailLimit);
        if (n > 0 && (head == null || head.length < size)) {
          tail = await _readFileRange(file, size - n, n);
        }
      }
    }
  } catch (_) {}

  return (lat: lat, lng: lng, path: path, head: head, tail: tail);
}

Future<Uint8List> _readFileRange(File file, int start, int length) async {
  if (length <= 0) return Uint8List(0);
  final raf = await file.open();
  try {
    await raf.setPosition(start);
    const chunk = 512 * 1024;
    if (length <= chunk) {
      return await raf.read(length);
    }
    final out = BytesBuilder(copy: false);
    var remaining = length;
    while (remaining > 0) {
      final take = remaining > chunk ? chunk : remaining;
      out.add(await raf.read(take));
      remaining -= take;
      await Future<void>.delayed(Duration.zero);
    }
    return out.takeBytes();
  } finally {
    await raf.close();
  }
}

/// Oynatma için MediaStore content URI (file path’ten daha güvenilir).
Future<String?> phoneAssetPlayableUri(String assetId) async {
  try {
    final asset = await AssetEntity.fromId(assetId);
    if (asset == null) return null;
    final url = await asset.getMediaUrl();
    if (url != null && url.isNotEmpty) return url;
  } catch (_) {}
  return null;
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
  if (kIsWeb || !(Platform.isAndroid || Platform.isIOS)) return null;
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
