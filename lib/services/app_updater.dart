import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:open_filex/open_filex.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../app_version.dart';

const githubRepo = 'alid67-git/MedyaAtlas';
/// Sabit dosya adı — sürüm numarası yok; her release’te aynı isim.
const apkAssetName = 'MedyaAtlas.apk';
const apkLatestUrl =
    'https://github.com/$githubRepo/releases/latest/download/$apkAssetName';

class AppUpdateInfo {
  const AppUpdateInfo({
    required this.latestVersion,
    required this.downloadUrl,
    required this.releaseNotes,
  });

  final String latestVersion;
  final String downloadUrl;
  final String releaseNotes;

  bool get isNewer => _compareVersions(latestVersion, appVersion) > 0;
}

/// GitHub Releases’ten son sürümü oku.
Future<AppUpdateInfo?> fetchLatestRelease() async {
  if (kIsWeb || !Platform.isAndroid) return null;
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
    final assets = (json['assets'] as List?) ?? const [];
    String? url;
    for (final a in assets) {
      if (a is! Map) continue;
      final name = a['name'] as String? ?? '';
      if (name == apkAssetName || name.endsWith('.apk')) {
        url = a['browser_download_url'] as String?;
        if (name == apkAssetName) break;
      }
    }
    url ??= apkLatestUrl;
    final notes = (json['body'] as String?)?.trim() ?? '';
    return AppUpdateInfo(
      latestVersion: tag,
      downloadUrl: url,
      releaseNotes: notes,
    );
  } catch (_) {
    return null;
  }
}

/// APK indir ve kurulum ekranını aç.
Future<String?> downloadAndInstallApk(
  String url, {
  void Function(double progress)? onProgress,
}) async {
  if (!Platform.isAndroid) return 'Yalnızca Android.';
  final dir = await getTemporaryDirectory();
  final file = File(p.join(dir.path, apkAssetName));
  if (await file.exists()) {
    try {
      await file.delete();
    } catch (_) {}
  }
  final client = http.Client();
  try {
    // Sabit latest URL tercih: her zaman aynı dosya adı / CDN yönlendirmesi.
    final downloadUrl = (url.trim().isEmpty) ? apkLatestUrl : url;
    final req = http.Request('GET', Uri.parse(downloadUrl));
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
        // Boyut bilinmiyor: 0–0.9 arasında yumuşak ilerleme.
        onProgress?.call((received / (received + 5 * 1024 * 1024)).clamp(0.0, 0.9));
      }
    }
    await sink.close();
    if (!await file.exists() || await file.length() < 1024) {
      return 'İndirilen APK geçersiz veya boş.';
    }
    onProgress?.call(1.0);
    final result = await OpenFilex.open(
      file.path,
      type: 'application/vnd.android.package-archive',
    );
    if (result.type != ResultType.done) {
      return result.message.isEmpty
          ? 'Kurulum ekranı açılamadı. Ayarlar → Bilinmeyen uygulamalar izni verin.'
          : result.message;
    }
    return null;
  } catch (e) {
    return 'Güncelleme: $e';
  } finally {
    client.close();
  }
}

/// a > b → 1, a == b → 0, a < b → -1
int _compareVersions(String a, String b) {
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
