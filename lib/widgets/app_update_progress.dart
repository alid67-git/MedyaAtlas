import 'package:flutter/material.dart';

/// RideAtlas / GPX-edit tarzı indirme yüzdesi — büyük % ekranda.
class AppUpdateProgressPanel extends StatelessWidget {
  const AppUpdateProgressPanel({
    super.key,
    required this.progress,
    this.title = 'Güncelleme indiriliyor',
    this.subtitle,
  });

  /// 0–1. 0 veya negatif → belirsiz çubuk.
  final double progress;
  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final pct = (progress * 100).round().clamp(0, 100);
    final known = progress > 0;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          title,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w600,
              ),
        ),
        const SizedBox(height: 28),
        Text(
          known ? '%$pct' : '…',
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 56,
            fontWeight: FontWeight.w700,
            height: 1,
            letterSpacing: -1.5,
            color: Color(0xFF2EC4B6),
          ),
        ),
        const SizedBox(height: 20),
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: LinearProgressIndicator(
            value: known ? progress.clamp(0.0, 1.0) : null,
            minHeight: 10,
            backgroundColor: Colors.white.withValues(alpha: 0.12),
            color: const Color(0xFF2EC4B6),
          ),
        ),
        if (subtitle != null && subtitle!.isNotEmpty) ...[
          const SizedBox(height: 14),
          Text(
            subtitle!,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 13,
              color: Colors.white.withValues(alpha: 0.55),
            ),
          ),
        ],
      ],
    );
  }
}

/// Küçük diyalog: RideAtlas `installAppUpdate` ile aynı düzen.
Future<void> showAppUpdateProgressDialog({
  required BuildContext context,
  required ValueNotifier<double> progress,
  String title = 'Güncelleme indiriliyor',
  String? subtitle,
}) {
  return showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => PopScope(
      canPop: false,
      child: AlertDialog(
        contentPadding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
        content: ValueListenableBuilder<double>(
          valueListenable: progress,
          builder: (context, value, _) => AppUpdateProgressPanel(
            progress: value,
            title: title,
            subtitle: subtitle,
          ),
        ),
      ),
    ),
  );
}
