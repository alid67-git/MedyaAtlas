import 'package:flutter/material.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:provider/provider.dart';

import 'repositories/media_repository.dart';
import 'screens/home_map_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
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
