import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:open_filex/open_filex.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../app_version.dart';
import 'android_media_scan.dart';
import 'host_platform.dart';
import 'update_fs.dart';
import 'web_reload.dart';

const githubRepo = 'alid67-git/MedyaAtlas';

/// Sabit dosya adları — sürüm numarası yok; her release’te aynı isim.
const apkAssetName = 'MedyaAtlas.apk';
const windowsZipAssetName = 'MedyaAtlas-windows.zip';

const apkLatestUrl =
    'https://github.com/$githubRepo/releases/latest/download/$apkAssetName';
const windowsZipLatestUrl =
    'https://github.com/$githubRepo/releases/latest/download/$windowsZipAssetName';
const webAppLatestUrl = 'https://alid67-git.github.io/MedyaAtlas/';

enum UpdatePlatform { android, windows, web }

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

  /// En az 2 sürüm geride (veya major/minor atlanmış) → zorunlu güncelleme.
  bool get isForceRequired =>
      isForceUpdateRequired(current: appVersion, latest: latestVersion);

  String get dialogBody {
    switch (platform) {
      case UpdatePlatform.android:
        return 'Şu an v$appVersion.\n'
            '$assetName indirilip kurulum açılacak.';
      case UpdatePlatform.windows:
        return 'Şu an v$appVersion.\n'
            '$assetName indirilecek; klasör açılınca yeni '
            'medyaatlas.exe ile çalıştırın.';
      case UpdatePlatform.web:
        return 'Şu an v$appVersion.\n'
            'v$latestVersion için sayfa yenilenecek.';
    }
  }

  String get forceDialogBody {
    switch (platform) {
      case UpdatePlatform.android:
        return 'Bu sürüm (v$appVersion) artık desteklenmiyor.\n'
            'En az 2 sürüm geridesiniz; v$latestVersion yüklemeden '
            'MedyaAtlas kullanılamaz.';
      case UpdatePlatform.windows:
        return 'Bu sürüm (v$appVersion) artık desteklenmiyor.\n'
            'En az 2 sürüm geridesiniz; v$latestVersion yüklemeden '
            'MedyaAtlas kullanılamaz. Zip indirilip yeni medyaatlas.exe '
            'ile açılmalı.';
      case UpdatePlatform.web:
        return 'Bu sürüm (v$appVersion) artık desteklenmiyor.\n'
            'En az 2 sürüm geridesiniz; v$latestVersion için sayfayı '
            'yenilemeniz gerekir.';
    }
  }
}

/// Android / Windows indirme veya web sayfa yenileme.
bool get supportsInAppUpdate =>
    kIsWeb || hostIsAndroid || hostIsWindows;

UpdatePlatform? get currentUpdatePlatform {
  if (kIsWeb) return UpdatePlatform.web;
  if (hostIsAndroid) return UpdatePlatform.android;
  if (hostIsWindows) return UpdatePlatform.windows;
  return null;
}

/// GitHub Releases’ten son sürümü oku.
/// Web’de ayrıca canlı [version.json] kontrol edilir — yalnızca Pages
/// deploy edildiğinde de güncelleme uyarısı çıksın.
Future<AppUpdateInfo?> fetchLatestRelease() async {
  final platform = currentUpdatePlatform;
  if (platform == null) return null;
  try {
    final releaseInfo = await _fetchFromGitHubReleases(platform);
    if (platform != UpdatePlatform.web) return releaseInfo;

    final pagesInfo = await _fetchFromWebVersionJson();
    if (releaseInfo == null) return pagesInfo;
    if (pagesInfo == null) return releaseInfo;
    // Hangisi daha yeni ise onu kullan (Pages-only deploy kaçmasın).
    return compareVersions(
              pagesInfo.latestVersion,
              releaseInfo.latestVersion,
            ) >
            0
        ? pagesInfo
        : releaseInfo;
  } catch (_) {
    return null;
  }
}

Future<AppUpdateInfo?> _fetchFromWebVersionJson() async {
  try {
    final res = await http
        .get(
          Uri.parse('${webAppLatestUrl}version.json'),
          headers: {'User-Agent': 'MedyaAtlas/$appVersion'},
        )
        .timeout(const Duration(seconds: 15));
    if (res.statusCode != 200) return null;
    final json = jsonDecode(res.body) as Map<String, dynamic>;
    final ver = (json['version'] as String? ?? '').trim();
    if (ver.isEmpty) return null;
    return AppUpdateInfo(
      latestVersion: ver.replaceFirst('v', ''),
      downloadUrl: webAppLatestUrl,
      assetName: 'MedyaAtlas web',
      platform: UpdatePlatform.web,
      releaseNotes: '',
    );
  } catch (_) {
    return null;
  }
}

Future<AppUpdateInfo?> _fetchFromGitHubReleases(UpdatePlatform platform) async {
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
    final notes = (json['body'] as String?)?.trim() ?? '';

    if (platform == UpdatePlatform.web) {
      return AppUpdateInfo(
        latestVersion: tag,
        downloadUrl: webAppLatestUrl,
        assetName: 'MedyaAtlas web',
        platform: UpdatePlatform.web,
        releaseNotes: notes,
      );
    }

    final preferred = platform == UpdatePlatform.android
        ? apkAssetName
        : windowsZipAssetName;
    final fallbackUrl =
        platform == UpdatePlatform.android ? apkLatestUrl : windowsZipLatestUrl;
    final assets = (json['assets'] as List?) ?? const [];

    String? url;
    var assetName = preferred;
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

/// Güncelleme: APK kurulum / Windows zip / web sayfa yenileme.
Future<String?> downloadAndApplyUpdate(
  AppUpdateInfo info, {
  void Function(double progress)? onProgress,
}) async {
  switch (info.platform) {
    case UpdatePlatform.android:
      return _downloadAndroidApk(info.downloadUrl, onProgress: onProgress);
    case UpdatePlatform.windows:
      return _downloadWindowsZip(info.downloadUrl, onProgress: onProgress);
    case UpdatePlatform.web:
      onProgress?.call(1);
      await reloadWebApp();
      return null;
  }
}

Future<String?> _downloadAndroidApk(
  String url, {
  void Function(double progress)? onProgress,
}) async {
  if (!hostIsAndroid) return 'Yalnızca Android.';
  final dir = await apkDownloadDirectory();
  final path = p.join(dir.path, apkAssetName);
  final err = await downloadUrlToPath(
    url.trim().isEmpty ? apkLatestUrl : url,
    path,
    onProgress: onProgress,
    minBytes: 1024,
  );
  if (err != null) return err;
  final file = updateFile(path);
  if (!looksLikeApk(file)) {
    await deleteUpdatePath(path);
    return 'İndirilen dosya geçerli bir APK değil (ağ/HTML). Tekrar deneyin.';
  }

  return installApkFile(path);
}

Future<String?> _downloadWindowsZip(
  String url, {
  void Function(double progress)? onProgress,
}) async {
  if (!hostIsWindows) return 'Yalnızca Windows.';

  late final String outDirPath;
  try {
    outDirPath =
        (await getDownloadsDirectory() ?? await getTemporaryDirectory()).path;
  } catch (_) {
    outDirPath = (await getTemporaryDirectory()).path;
  }
  final zipPath = p.join(outDirPath, windowsZipAssetName);
  final err = await downloadUrlToPath(
    url.trim().isEmpty ? windowsZipLatestUrl : url,
    zipPath,
    onProgress: onProgress,
    minBytes: 1024,
  );
  if (err != null) return err;

  final extractPath = p.join(outDirPath, 'MedyaAtlas-update');
  final unzipErr = await unzipWindowsUpdate(zipPath, extractPath);
  if (unzipErr != null) {
    await OpenFilex.open(zipPath);
    return unzipErr;
  }

  await OpenFilex.open(extractPath);
  return null;
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

List<int> parseVersionParts(String v) {
  final parts = v
      .split(RegExp(r'[^0-9]+'))
      .where((s) => s.isNotEmpty)
      .map(int.parse)
      .toList();
  while (parts.length < 3) {
    parts.add(0);
  }
  return parts.take(3).toList();
}

/// [latest] kaç sürüm önde? Aynı major.minor’da patch farkı;
/// major/minor atlanmışsa büyük sayı (≥2 → zorunlu).
int versionsBehind({required String current, required String latest}) {
  if (compareVersions(latest, current) <= 0) return 0;
  final c = parseVersionParts(current);
  final l = parseVersionParts(latest);
  if (l[0] != c[0] || l[1] != c[1]) {
    return 999;
  }
  return l[2] - c[2];
}

/// 2+ sürüm geride → uygulama kullanılamaz, güncelleme zorunlu.
bool isForceUpdateRequired({
  required String current,
  required String latest,
}) =>
    versionsBehind(current: current, latest: latest) >= 2;
