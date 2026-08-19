import 'package:web/web.dart' as web;

void openUrlInNewTab(String url) {
  if (url.isEmpty) return;
  web.window.open(url, '_blank');
}
