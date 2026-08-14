import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:provider/provider.dart';

import 'repositories/media_repository.dart';
import 'screens/home_map_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Marker NaN gibi hatalarda tüm uygulama kırmızı ekranda kalmasın.
  ErrorWidget.builder = (details) {
    assert(() {
      debugPrint('MedyaAtlas ErrorWidget: ${details.exceptionAsString()}');
      return true;
    }());
    return const ColoredBox(
      color: Color(0xFF071018),
      child: Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Harita geçici olarak yenilenemedi.\n'
            'Tarama sürüyorsa bitmesini bekle veya İptal’e bas.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white70, fontSize: 14),
          ),
        ),
      ),
    );
  };
  await Hive.initFlutter();
  await MediaRepository.instance.init();
  runApp(const MedyaAtlasApp());
}

class MedyaAtlasApp extends StatelessWidget {
  const MedyaAtlasApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider.value(
      value: MediaRepository.instance,
      child: MaterialApp(
        title: 'MedyaAtlas',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          brightness: Brightness.dark,
          scaffoldBackgroundColor: const Color(0xFF071018),
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF2EC4B6),
            brightness: Brightness.dark,
          ),
          useMaterial3: true,
        ),
        home: const HomeMapScreen(),
      ),
    );
  }
}
