import 'dart:io';

Future<void> openPathWithWindowsShell(String path) async {
  await Process.start(
    'cmd',
    ['/c', 'start', '', path],
    runInShell: false,
  );
}
