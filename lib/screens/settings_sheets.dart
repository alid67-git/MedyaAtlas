import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_version.dart';
import '../l10n/app_strings.dart';
import '../services/app_settings.dart';
import '../services/version_history.dart';

Future<void> openSettingsSheet(
  BuildContext context, {
  VoidCallback? onCheckUpdate,
}) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFF0A1C28),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (ctx) {
      return Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 12,
          bottom: MediaQuery.viewInsetsOf(ctx).bottom + 16,
        ),
        child: Consumer<AppSettings>(
          builder: (context, st, _) {
            final t = S.of(st);
            return SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.white24,
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    t.settings,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(t.language, style: const TextStyle(fontSize: 13)),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    children: [
                      for (final lang in AppLang.values)
                        ChoiceChip(
                          label: Text(t.langLabel(lang)),
                          selected: st.lang == lang,
                          onSelected: (_) => st.setLang(lang),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t.developedBy),
                    subtitle: const Text(appDeveloperName),
                  ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t.version),
                    subtitle: Text('v$appVersion'),
                  ),
                  if (onCheckUpdate != null)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.system_update_alt),
                      title: const Text('Güncelleme kontrol et'),
                      subtitle: Text(
                        kIsWeb
                            ? 'Web: GitHub sürümü → sayfa yenile'
                            : 'GitHub Releases',
                      ),
                      onTap: () {
                        Navigator.pop(ctx);
                        onCheckUpdate();
                      },
                    ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t.versionHistory),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => openVersionHistorySheet(context),
                  ),
                  const SizedBox(height: 8),
                ],
              ),
            );
          },
        ),
      );
    },
  );
}

Future<void> openVersionHistorySheet(BuildContext context) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFF0A1C28),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (ctx) {
      return Consumer<AppSettings>(
        builder: (context, st, _) {
          final t = S.of(st);
          return DraggableScrollableSheet(
            expand: false,
            initialChildSize: 0.7,
            minChildSize: 0.4,
            maxChildSize: 0.95,
            builder: (context, scroll) {
              return Column(
                children: [
                  const SizedBox(height: 10),
                  Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            t.versionHistory,
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        IconButton(
                          tooltip: t.close,
                          onPressed: () => Navigator.pop(context),
                          icon: const Icon(Icons.close),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: ListView.separated(
                      controller: scroll,
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                      itemCount: versionHistory.length,
                      separatorBuilder: (_, index) => const Divider(height: 1),
                      itemBuilder: (context, i) {
                        final e = versionHistory[i];
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            'v${e.version}',
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          subtitle: Padding(
                            padding: const EdgeInsets.only(top: 4, bottom: 8),
                            child: Text(e.text(st.lang)),
                          ),
                        );
                      },
                    ),
                  ),
                ],
              );
            },
          );
        },
      );
    },
  );
}

Future<void> openHelpSheet(BuildContext context) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFF0A1C28),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (ctx) {
      return DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.75,
        minChildSize: 0.4,
        maxChildSize: 0.95,
        builder: (context, scroll) {
          return Consumer<AppSettings>(
            builder: (context, st, _) {
              final t = S.of(st);
              return Column(
                children: [
                  const SizedBox(height: 10),
                  Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            t.helpTitle,
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        IconButton(
                          tooltip: t.close,
                          onPressed: () => Navigator.pop(ctx),
                          icon: const Icon(Icons.close),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: ListView(
                      controller: scroll,
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                      children: [
                        SelectableText(
                          t.helpBody.trim(),
                          style: TextStyle(
                            fontSize: 14,
                            height: 1.45,
                            color: Colors.white.withValues(alpha: 0.88),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              );
            },
          );
        },
      );
    },
  );
}

Future<void> openMapLayerSheet(BuildContext context) async {
  await showModalBottomSheet<void>(
    context: context,
    backgroundColor: const Color(0xFF0A1C28),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (ctx) {
      return Consumer<AppSettings>(
        builder: (context, st, _) {
          final t = S.of(st);
          return SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const SizedBox(height: 10),
                Text(
                  t.mapLayers,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 8),
                for (final layer in MapLayer.values)
                  ListTile(
                    leading: Icon(
                      st.mapLayer == layer
                          ? Icons.radio_button_checked
                          : Icons.radio_button_off,
                      color: const Color(0xFF2EC4B6),
                    ),
                    title: Text(t.mapLayerLabel(layer)),
                    onTap: () async {
                      await st.setMapLayer(layer);
                      if (ctx.mounted) Navigator.pop(ctx);
                    },
                  ),
                const SizedBox(height: 8),
              ],
            ),
          );
        },
      );
    },
  );
}
