import 'package:web/web.dart' as web;

Future<void> reloadWebApp() async {
  // Önbelleği kırarak güncel Pages derlemesini al.
  final loc = web.window.location;
  final base = '${loc.origin}${loc.pathname}';
  final stamp = DateTime.now().millisecondsSinceEpoch;
  loc.href = '$base?v=$stamp';
}
