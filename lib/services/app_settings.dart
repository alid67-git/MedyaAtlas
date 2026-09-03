import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';

enum AppLang { tr, en, de }

enum MapLayer {
  satellite,
  streets,
  topo,
  dark,
}

/// Sabit kredi — kullanıcı tarafından değiştirilmez.
const appDeveloperName = 'Ali Dinçer';

class AppSettings extends ChangeNotifier {
  AppSettings._();
  static final instance = AppSettings._();

  static const _boxName = 'medyaatlas_settings';
  late Box _box;

  AppLang lang = AppLang.tr;
  MapLayer mapLayer = MapLayer.satellite;

  Future<void> init() async {
    _box = await Hive.openBox(_boxName);
    lang = AppLang.values.firstWhere(
      (e) => e.name == (_box.get('lang') as String? ?? 'tr'),
      orElse: () => AppLang.tr,
    );
    mapLayer = MapLayer.values.firstWhere(
      (e) => e.name == (_box.get('mapLayer') as String? ?? 'satellite'),
      orElse: () => MapLayer.satellite,
    );
  }

  Future<void> setLang(AppLang value) async {
    lang = value;
    await _box.put('lang', value.name);
    notifyListeners();
  }

  Future<void> setMapLayer(MapLayer value) async {
    mapLayer = value;
    await _box.put('mapLayer', value.name);
    notifyListeners();
  }

  String get mapUrlTemplate => switch (mapLayer) {
        MapLayer.satellite =>
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        MapLayer.streets =>
          'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        MapLayer.topo =>
          'https://tile.opentopomap.org/{z}/{x}/{y}.png',
        MapLayer.dark =>
          'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      };

  String? get mapAttribution => switch (mapLayer) {
        MapLayer.satellite => 'Esri / ArcGIS',
        MapLayer.streets => '© OpenStreetMap',
        MapLayer.topo => '© OpenTopoMap',
        MapLayer.dark => '© CARTO / OSM',
      };
}
