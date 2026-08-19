import '../models/library_media.dart';

DateTime _mediaTime(LibraryMedia m) => m.takenAt ?? m.addedAt;

/// Gün anahtarı (yerel): yyyy-MM-dd
String dayKeyOf(LibraryMedia m) {
  final t = _mediaTime(m).toLocal();
  final mm = t.month.toString().padLeft(2, '0');
  final dd = t.day.toString().padLeft(2, '0');
  return '${t.year}-$mm-$dd';
}

const _trMonths = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
];
const _trWeekdays = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

String formatMediaDayTitle(DateTime dt) {
  final t = dt.toLocal();
  return '${t.day} ${_trMonths[t.month - 1]} ${t.year} ${_trWeekdays[t.weekday % 7]}';
}

String formatMediaMonthYear(DateTime dt) {
  final t = dt.toLocal();
  return '${_trMonths[t.month - 1]} ${t.year}';
}

/// Yeniden eskiye gün grupları.
List<({String key, String title, List<LibraryMedia> items})> groupMediaByDay(
  List<LibraryMedia> items,
) {
  final sorted = [...items]
    ..sort((a, b) => _mediaTime(b).compareTo(_mediaTime(a)));
  final map = <String, List<LibraryMedia>>{};
  for (final m in sorted) {
    map.putIfAbsent(dayKeyOf(m), () => []).add(m);
  }
  return [
    for (final e in map.entries)
      (
        key: e.key,
        title: formatMediaDayTitle(_mediaTime(e.value.first)),
        items: e.value,
      ),
  ];
}

String mediaCountLabel(List<LibraryMedia> items) {
  final photos = items.where((m) => m.kind == MediaKind.photo).length;
  final videos = items.length - photos;
  if (videos == 0) return '$photos fotoğraf';
  if (photos == 0) return '$videos video';
  return '${items.length} medya';
}

String? mediaDateRangeLabel(List<LibraryMedia> items) {
  if (items.isEmpty) return null;
  DateTime? minT;
  DateTime? maxT;
  for (final m in items) {
    final t = _mediaTime(m);
    minT = minT == null || t.isBefore(minT) ? t : minT;
    maxT = maxT == null || t.isAfter(maxT) ? t : maxT;
  }
  if (minT == null || maxT == null) return null;
  final a = formatMediaMonthYear(minT);
  final b = formatMediaMonthYear(maxT);
  return a == b ? a : '$a — $b';
}

LibraryMedia coverMediaOf(List<LibraryMedia> items) {
  if (items.isEmpty) {
    throw ArgumentError('coverMediaOf boş liste');
  }
  final photos = items.where((m) => !m.isVideo).toList();
  final pool = photos.isNotEmpty ? photos : items;
  pool.sort((a, b) => _mediaTime(b).compareTo(_mediaTime(a)));
  return pool.first;
}
