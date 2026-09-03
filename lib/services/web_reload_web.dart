import 'dart:js_interop';

import 'package:web/web.dart' as web;

/// Sabit web adresi — her sürüm aynı yola yazılır (/r/x.y.z yok).
const _webAppRootUrl = 'https://alid67-git.github.io/MedyaAtlas/';

String get webAppReleasePathUrl => _webAppRootUrl;

Future<void> reloadWebApp() async {
  try {
    await _purgeWebCaches();
  } catch (_) {}

  final stamp = DateTime.now().millisecondsSinceEpoch;
  web.window.location.replace('$_webAppRootUrl?t=$stamp');
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
