import 'dart:js_interop';

import 'package:web/web.dart' as web;

/// Sabit web adresi — her sürüm aynı yola yazılır (/r/x.y.z yok).
const _webAppRootUrl = 'https://alid67-git.github.io/MedyaAtlas/';

String get webAppReleasePathUrl => _webAppRootUrl;

@JS('MedyaAtlasUpdate')
external JSObject? get _medyaAtlasUpdate;

extension type _UpdateApi(JSObject _) implements JSObject {
  external JSPromise<JSAny?> check();
  external void show([JSString? reason]);
  external void apply();
}

/// Alt banner / SW güncellemesini tetikle (paralel diyalog yok).
void triggerWebUpdateCheck() {
  final raw = _medyaAtlasUpdate;
  if (raw == null) return;
  final api = _UpdateApi(raw);
  try {
    api.check();
  } catch (_) {
    try {
      api.show('version'.toJS);
    } catch (_) {}
  }
}

Future<void> reloadWebApp() async {
  // Önce SW banner yolu (SKIP_WAITING); yoksa sert yenileme.
  final raw = _medyaAtlasUpdate;
  if (raw != null) {
    try {
      _UpdateApi(raw).apply();
      return;
    } catch (_) {}
  }
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
    // Bizim SW’yi silme — sadece eski yabancı kayıtlar.
    final script = reg.active?.scriptURL ??
        reg.waiting?.scriptURL ??
        reg.installing?.scriptURL ??
        '';
    if (script.contains('sw.js')) continue;
    await reg.unregister().toDart;
  }

  final keys = (await web.window.caches.keys().toDart).toDart;
  for (final key in keys) {
    final name = key.toDart;
    if (name.startsWith('medyaatlas-v')) continue;
    await web.window.caches.delete(name).toDart;
  }
}
