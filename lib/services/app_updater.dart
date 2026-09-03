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

/// RideAtlas tarzı sabit etiketler — URL’de sürüm yok.
const androidLatestTag = 'android-latest';
const windowsLatestTag = 'windows-latest';

const apkLatestUrl =
    'https://github.com/$githubRepo/releases/download/$androidLatestTag/$apkAssetName';
const windowsZipLatestUrl =
    'https://github.com/$githubRepo/releases/download/$windowsLatestTag/$windowsZipAssetName';
const webAppRootUrl = 'https://alid67-git.github.io/MedyaAtlas/';

/// Canlı web — her sürüm aynı adrese yazılır (/r/x.y.z yok).
String get webAppLatestUrl => webAppRootUrl;

enum UpdatePlatform { android, windows, web }

class AppUpdateInfo {
  const AppUpdateInfo({
    required this.latestVersion,
    required this.downloadUrl,
    required this.assetName,
    required this.platform,
    required this.releaseNotes,
    this.sizeBytes = 0,
  });

  final String latestVersion;
  final String downloadUrl;
  final String assetName;
  final UpdatePlatform platform;
  final String releaseNotes;
  /// GitHub asset boyutu — CDN Content-Length vermezse yüzde için.
  final int sizeBytes;

  bool get isNewer => compareVersions(latestVersion, appVersion) > 0;

  /// En az 2 sürüm geride (veya major/minor atlanmış) → zorunlu güncelleme.
  bool get isForceRequired =>
      isForceUpdateRequired(current: appVersion, latest: latestVersion);

  String get dialogBody =>
      'Sizin: v$appVersion\nGüncel: v$latestVersion';

  String get forceDialogBody =>
      'Sizin: v$appVersion\nGüncel: v$latestVersion';
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
          Uri.parse('${webAppRootUrl}version.json'),
          headers: {'User-Agent': 'MediaAtlas/$appVersion'},
        )
        .timeout(const Duration(seconds: 15));
    if (res.statusCode != 200) return null;
    final json = jsonDecode(res.body) as Map<String, dynamic>;
    final ver = (json['version'] as String? ?? '').replaceFirst('v', '').trim();
    if (ver.isEmpty) return null;
    return AppUpdateInfo(
      latestVersion: ver,
      downloadUrl: webAppRootUrl,
      assetName: 'MediaAtlas web',
      platform: UpdatePlatform.web,
      releaseNotes: '',
    );
  } catch (_) {
    return null;
  }
}

Future<AppUpdateInfo?> _fetchFromGitHubReleases(UpdatePlatform platform) async {
  try {
    if (platform == UpdatePlatform.web) {
      // Web sürümü Pages version.json’dan; release tag’e bakma.
      return null;
    }

    final rollingTag = platform == UpdatePlatform.android
        ? androidLatestTag
        : windowsLatestTag;
    final preferred = platform == UpdatePlatform.android
        ? apkAssetName
        : windowsZipAssetName;
    final fallbackUrl = platform == UpdatePlatform.android
        ? apkLatestUrl
        : windowsZipLatestUrl;

    final res = await http
        .get(
          Uri.parse(
            'https://api.github.com/repos/$githubRepo/releases/tags/$rollingTag',
          ),
          headers: {
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'MediaAtlas/$appVersion',
          },
        )
        .timeout(const Duration(seconds: 20));
    if (res.statusCode != 200) return null;
    final json = jsonDecode(res.body) as Map<String, dynamic>;
    final notes = (json['body'] as String?)?.trim() ?? '';
    final ver = _versionFromRollingRelease(json);
    if (ver == null || ver.isEmpty) return null;

    final assets = (json['assets'] as List?) ?? const [];
    var sizeBytes = 0;
    for (final a in assets) {
      if (a is! Map) continue;
      final name = a['name'] as String? ?? '';
      final match = platform == UpdatePlatform.android
          ? (name == apkAssetName || name.endsWith('.apk'))
          : (name == windowsZipAssetName ||
              (name.endsWith('.zip') && name.toLowerCase().contains('windows')));
      if (!match) continue;
      sizeBytes = (a['size'] as num?)?.toInt() ?? 0;
      if (name == preferred) break;
    }

    // Her zaman sabit URL — ara sürüm / versioned asset yok.
    return AppUpdateInfo(
      latestVersion: ver,
      downloadUrl: fallbackUrl,
      assetName: preferred,
      platform: platform,
      releaseNotes: notes,
      sizeBytes: sizeBytes,
    );
  } catch (_) {
    return null;
  }
}

/// `MediaAtlas Android (latest) - 1.0.35` veya gövdede `Sürüm: 1.0.35`.
String? _versionFromRollingRelease(Map<String, dynamic> json) {
  final name = (json['name'] as String?)?.trim() ?? '';
  final body = (json['body'] as String?)?.trim() ?? '';
  final fromName = RegExp(r'(\d+\.\d+\.\d+)').firstMatch(name)?.group(1);
  if (fromName != null) return fromName;
  final fromBody = RegExp(
    r'S[uü]r[uü]m\s*:\s*(\d+\.\d+\.\d+)',
    caseSensitive: false,
  ).firstMatch(body)?.group(1);
  if (fromBody != null) return fromBody;
  return RegExp(r'(\d+\.\d+\.\d+)').firstMatch(body)?.group(1);
}

/// Güncelleme: APK kurulum / Windows zip / web sayfa yenileme.
Future<String?> downloadAndApplyUpdate(
  AppUpdateInfo info, {
  void Function(double progress)? onProgress,
}) async {
  switch (info.platform) {
    case UpdatePlatform.android:
      return _downloadAndroidApk(
        info.downloadUrl,
        onProgress: onProgress,
        knownTotalBytes: info.sizeBytes,
      );
    case UpdatePlatform.windows:
      return _downloadWindowsZip(
        info.downloadUrl,
        onProgress: onProgress,
        knownTotalBytes: info.sizeBytes,
      );
    case UpdatePlatform.web:
      onProgress?.call(1);
      await reloadWebApp();
      return null;
  }
}

Future<String?> _downloadAndroidApk(
  String url, {
  void Function(double progress)? onProgress,
  int knownTotalBytes = 0,
}) async {
  if (!hostIsAndroid) return 'Yalnızca Android.';
  final dir = await apkDownloadDirectory();
  final path = p.join(dir.path, apkAssetName);
  final err = await downloadUrlToPath(
    url.trim().isEmpty ? apkLatestUrl : url,
    path,
    onProgress: onProgress,
    minBytes: 1024,
    knownTotalBytes: knownTotalBytes,
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
  int knownTotalBytes = 0,
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
    knownTotalBytes: knownTotalBytes,
  );
  if (err != null) return err;

  final extractPath = p.join(outDirPath, 'MediaAtlas-update');
  final unzipErr = await unzipWindowsUpdate(zipPath, extractPath);
  if (unzipErr != null) {
    await OpenFilex.open(zipPath);
    return unzipErr;
  }

  if (await launchWindowsUpdate(extractPath)) {
    return null;
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

/// Zorunlu güncelleme şimdilik kapalı — yalnızca isteğe bağlı diyalog.
bool isForceUpdateRequired({
  required String current,
  required String latest,
}) =>
    false;
