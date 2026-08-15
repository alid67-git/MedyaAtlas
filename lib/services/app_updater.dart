import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:open_filex/open_filex.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../app_version.dart';
import 'android_media_scan.dart';

const githubRepo = 'alid67-git/MedyaAtlas';

/// Sabit dosya adları — sürüm numarası yok; her release’te aynı isim.
const apkAssetName = 'MedyaAtlas.apk';
const windowsZipAssetName = 'MedyaAtlas-windows.zip';

const apkLatestUrl =
    'https://github.com/$githubRepo/releases/latest/download/$apkAssetName';
const windowsZipLatestUrl =
    'https://github.com/$githubRepo/releases/latest/download/$windowsZipAssetName';

enum UpdatePlatform { android, windows }

class AppUpdateInfo {
  const AppUpdateInfo({
    required this.latestVersion,
    required this.downloadUrl,
    required this.assetName,
    required this.platform,
    required this.releaseNotes,
  });

  final String latestVersion;
  final String downloadUrl;
  final String assetName;
  final UpdatePlatform platform;
  final String releaseNotes;

  bool get isNewer => compareVersions(latestVersion, appVersion) > 0;

  String get dialogBody {
    switch (platform) {
      case UpdatePlatform.android:
        return 'Şu an v$appVersion.\n'
            '$assetName indirilip kurulum açılacak.';
      case UpdatePlatform.windows:
        return 'Şu an v$appVersion.\n'
            '$assetName indirilecek; klasör açılınca yeni '
            'medyaatlas.exe ile çalıştırın.';
    }
  }
}

bool get supportsInAppUpdate {
  if (kIsWeb) return false;
  return Platform.isAndroid || Platform.isWindows;
}

UpdatePlatform? get currentUpdatePlatform {
  if (kIsWeb) return null;
  if (Platform.isAndroid) return UpdatePlatform.android;
  if (Platform.isWindows) return UpdatePlatform.windows;
  return null;
}

/// GitHub Releases’ten son sürümü oku (Android APK veya Windows zip).
Future<AppUpdateInfo?> fetchLatestRelease() async {
  final platform = currentUpdatePlatform;
  if (platform == null) return null;
  try {
    final res = await http
        .get(
          Uri.parse(
            'https://api.github.com/repos/$githubRepo/releases/latest',
          ),
          headers: {
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'MedyaAtlas/$appVersion',
          },
        )
        .timeout(const Duration(seconds: 20));
    if (res.statusCode != 200) return null;
    final json = jsonDecode(res.body) as Map<String, dynamic>;
    final tag = (json['tag_name'] as String? ?? '').replaceFirst('v', '');
    if (tag.isEmpty) return null;

    final preferred = platform == UpdatePlatform.android
        ? apkAssetName
        : windowsZipAssetName;
    final fallbackUrl =
        platform == UpdatePlatform.android ? apkLatestUrl : windowsZipLatestUrl;
    final assets = (json['assets'] as List?) ?? const [];

    String? url;
    String assetName = preferred;
    for (final a in assets) {
      if (a is! Map) continue;
      final name = a['name'] as String? ?? '';
      final match = platform == UpdatePlatform.android
          ? (name == apkAssetName || name.endsWith('.apk'))
          : (name == windowsZipAssetName ||
              (name.endsWith('.zip') && name.toLowerCase().contains('windows')));
      if (!match) continue;
      url = a['browser_download_url'] as String?;
      assetName = name;
      if (name == preferred) break;
    }
    url ??= fallbackUrl;
    assetName = preferred;

    final notes = (json['body'] as String?)?.trim() ?? '';
    return AppUpdateInfo(
      latestVersion: tag,
      downloadUrl: url,
      assetName: assetName,
      platform: platform,
      releaseNotes: notes,
    );
  } catch (_) {
    return null;
  }
}

/// Güncelleme paketini indir ve aç (APK kurulum / Windows zip klasörü).
Future<String?> downloadAndApplyUpdate(
  AppUpdateInfo info, {
  void Function(double progress)? onProgress,
}) async {
  switch (info.platform) {
    case UpdatePlatform.android:
      return _downloadAndroidApk(info.downloadUrl, onProgress: onProgress);
    case UpdatePlatform.windows:
      return _downloadWindowsZip(info.downloadUrl, onProgress: onProgress);
  }
}

Future<String?> _downloadAndroidApk(
  String url, {
  void Function(double progress)? onProgress,
}) async {
  if (!Platform.isAndroid) return 'Yalnızca Android.';
  final dir = await apkDownloadDirectory();
  final file = File(p.join(dir.path, apkAssetName));
  final err = await _downloadToFile(
    url.trim().isEmpty ? apkLatestUrl : url,
    file,
    onProgress: onProgress,
    minBytes: 1024,
  );
  if (err != null) return err;
  if (!looksLikeApk(file)) {
    try {
      await file.delete();
    } catch (_) {}
    return 'İndirilen dosya geçerli bir APK değil (ağ/HTML). Tekrar deneyin.';
  }

  return installApkFile(file.path);
}

Future<String?> _downloadWindowsZip(
  String url, {
  void Function(double progress)? onProgress,
}) async {
  if (!Platform.isWindows) return 'Yalnızca Windows.';

  Directory outDir;
  try {
    outDir = await getDownloadsDirectory() ?? await getTemporaryDirectory();
  } catch (_) {
    outDir = await getTemporaryDirectory();
  }
  final zipFile = File(p.join(outDir.path, windowsZipAssetName));
  final err = await _downloadToFile(
    url.trim().isEmpty ? windowsZipLatestUrl : url,
    zipFile,
    onProgress: onProgress,
    minBytes: 1024,
  );
  if (err != null) return err;

  final extractDir = Directory(p.join(outDir.path, 'MedyaAtlas-update'));
  if (await extractDir.exists()) {
    try {
      await extractDir.delete(recursive: true);
    } catch (_) {}
  }
  await extractDir.create(recursive: true);

  final unzip = await Process.run(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "Expand-Archive -LiteralPath '${zipFile.path.replaceAll("'", "''")}' "
          "-DestinationPath '${extractDir.path.replaceAll("'", "''")}' -Force",
    ],
    runInShell: true,
  );
  if (unzip.exitCode != 0) {
    // Zip açılamazsa en azından dosyayı göster.
    await OpenFilex.open(zipFile.path);
    return 'Zip indirildi ama açılamadı. Dosya: ${zipFile.path}';
  }

  await OpenFilex.open(extractDir.path);
  return null;
}

Future<String?> _downloadToFile(
  String url,
  File file, {
  void Function(double progress)? onProgress,
  required int minBytes,
}) async {
  if (await file.exists()) {
    try {
      await file.delete();
    } catch (_) {}
  }
  final client = http.Client();
  try {
    final req = http.Request('GET', Uri.parse(url));
    req.headers['User-Agent'] = 'MedyaAtlas/$appVersion';
    final res = await client.send(req).timeout(const Duration(minutes: 8));
    if (res.statusCode != 200) {
      return 'İndirme başarısız (${res.statusCode}).';
    }
    final total = res.contentLength ?? 0;
    final sink = file.openWrite();
    var received = 0;
    await for (final chunk in res.stream) {
      sink.add(chunk);
      received += chunk.length;
      if (total > 0) {
        onProgress?.call(received / total);
      } else if (received > 0) {
        onProgress?.call(
          (received / (received + 5 * 1024 * 1024)).clamp(0.0, 0.9),
        );
      }
    }
    await sink.close();
    if (!await file.exists() || await file.length() < minBytes) {
      return 'İndirilen dosya geçersiz veya boş.';
    }
    onProgress?.call(1.0);
    return null;
  } catch (e) {
    return 'Güncelleme: $e';
  } finally {
    client.close();
  }
}

/// a > b → 1, a == b → 0, a < b → -1
int compareVersions(String a, String b) {
  List<int> parts(String v) => v
      .split(RegExp(r'[^0-9]+'))
      .where((s) => s.isNotEmpty)
      .map(int.parse)
      .toList();
  final pa = parts(a);
  final pb = parts(b);
  final n = pa.length > pb.length ? pa.length : pb.length;
  for (var i = 0; i < n; i++) {
    final x = i < pa.length ? pa[i] : 0;
    final y = i < pb.length ? pb[i] : 0;
    if (x != y) return x.compareTo(y);
  }
  return 0;
}
