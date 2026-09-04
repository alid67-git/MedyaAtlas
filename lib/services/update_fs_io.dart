import 'dart:io';

import 'package:http/http.dart' as http;

import '../app_version.dart';

Object updateFile(String path) => File(path);

Future<void> deleteUpdatePath(String path) async {
  try {
    final f = File(path);
    if (await f.exists()) await f.delete();
  } catch (_) {}
}

Future<String?> downloadUrlToPath(
  String url,
  String path, {
  void Function(double progress)? onProgress,
  required int minBytes,
  int knownTotalBytes = 0,
}) async {
  final file = File(path);
  if (await file.exists()) {
    try {
      await file.delete();
    } catch (_) {}
  }
  final client = http.Client();
  try {
    final req = http.Request('GET', Uri.parse(url));
    req.headers['User-Agent'] = 'MediaAtlas/$appVersion';
    final res = await client.send(req).timeout(const Duration(minutes: 8));
    if (res.statusCode != 200) {
      return 'İndirme başarısız (${res.statusCode}).';
    }
    final total = res.contentLength ??
        (knownTotalBytes > 0 ? knownTotalBytes : 0);
    final sink = file.openWrite();
    var received = 0;
    var lastPct = -1;
    await for (final chunk in res.stream) {
      sink.add(chunk);
      received += chunk.length;
      if (total > 0) {
        final pct = (received * 100 ~/ total).clamp(0, 100);
        if (pct != lastPct || received >= total) {
          lastPct = pct;
          onProgress?.call((received / total).clamp(0.0, 1.0));
        }
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

Future<String?> unzipWindowsUpdate(String zipPath, String extractPath) async {
  final extractDir = Directory(extractPath);
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
      "Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' "
          "-DestinationPath '${extractPath.replaceAll("'", "''")}' -Force",
    ],
    runInShell: true,
  );
  if (unzip.exitCode != 0) {
    return 'Zip indirildi ama açılamadı. Dosya: $zipPath';
  }
  return null;
}

/// Yeni exe’yi başlat; başarılıysa eski süreci kapat.
Future<bool> launchWindowsUpdate(String extractPath) async {
  try {
    final root = Directory(extractPath);
    if (!await root.exists()) return false;
    await for (final entity in root.list(recursive: true)) {
      if (entity is! File) continue;
      if (!entity.path.toLowerCase().endsWith('.exe')) continue;
      await Process.start(
        entity.path,
        const [],
        mode: ProcessStartMode.detached,
      );
      await Future<void>.delayed(const Duration(milliseconds: 400));
      exit(0);
    }
  } catch (_) {}
  return false;
}
