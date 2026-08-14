String normalizeSearchText(String text) {
  final lowered = text.trim().toLowerCase();
  final normalized = lowered.replaceAllMapped(
    RegExp(r'[çğıöşüâîû]'),
    (m) => switch (m[0]) {
      'ç' => 'c',
      'ğ' => 'g',
      'ı' => 'i',
      'ö' => 'o',
      'ş' => 's',
      'ü' => 'u',
      'â' => 'a',
      'î' => 'i',
      'û' => 'u',
      _ => m[0]!,
    },
  );
  return normalized;
}

bool matchesMediaSearch(String haystackNorm, String needleNorm) {
  if (needleNorm.isEmpty) return true;
  if (haystackNorm.isEmpty) return false;
  return haystackNorm == needleNorm ||
      haystackNorm.startsWith(needleNorm) ||
      haystackNorm.contains(needleNorm);
}

bool itemMatchesQuery({
  required String name,
  String? relativePath,
  String? sourceLabel,
  required String query,
}) {
  final needle = normalizeSearchText(query);
  if (needle.isEmpty) return true;
  final hay = normalizeSearchText(
    [name, relativePath ?? '', sourceLabel ?? ''].where((s) => s.isNotEmpty).join(' '),
  );
  return matchesMediaSearch(hay, needle);
}
