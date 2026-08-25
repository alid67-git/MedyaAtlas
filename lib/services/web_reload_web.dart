import 'dart:js_interop';

import 'package:web/web.dart' as web;

import '../app_version.dart';

/// Sürüm klasörü — eski Flutter SW'nin /MedyaAtlas/index.html precache'inden kaçınır.
String get webAppReleasePathUrl =>
    'https://alid67-git.github.io/MedyaAtlas/r/$appVersion/';

Future<void> reloadWebApp() async {
  try {
    await _purgeWebCaches();
  } catch (_) {}

  final stamp = DateTime.now().millisecondsSinceEpoch;
  web.window.location.replace('$webAppReleasePathUrl?t=$stamp');
}

Future<void> _purgeWebCaches() async {
  final regs =
      (await web.window.navigator.serviceWorker.getRegistrations().toDart)
          .toDart;
  for (final reg in regs) {
    await reg.unregister().toDart;
  }

  final keys = (await web.window.caches.keys().toDart).toDart;
  for (final key in keys) {
    await web.window.caches.delete(key.toDart).toDart;
  }
}
