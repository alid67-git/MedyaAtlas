import 'dart:js_interop';

import 'package:web/web.dart' as web;

/// Canlı Pages kökü — [app_updater.webAppLatestUrl] ile aynı.
const _webAppLatestUrl = 'https://alid67-git.github.io/MedyaAtlas/';

/// iPhone Ana Ekran / Safari: eski service worker + HTTP cache yüzünden
/// `?v=` ile sayfa yenilense bile `main.dart.js` eski kalabiliyor.
Future<void> reloadWebApp() async {
  try {
    await _purgeWebCaches();
  } catch (_) {}

  final stamp = DateTime.now().millisecondsSinceEpoch;
  // Canonical Pages URL — standalone PWA pathname tuhaflıklarını atla.
  final url = '$_webAppLatestUrl?v=$stamp#updated';
  web.window.location.replace(url);
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
