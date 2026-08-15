import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';

enum AppLang { tr, en, de }

enum MapLayer {
  satellite,
  streets,
  topo,
  dark,
}

class AppSettings extends ChangeNotifier {
  AppSettings._();
  static final instance = AppSettings._();

  static const _boxName = 'medyaatlas_settings';
  late Box _box;

  AppLang lang = AppLang.tr;
  String developerName = 'Ali Dinçer';
  MapLayer mapLayer = MapLayer.satellite;

  Future<void> init() async {
    _box = await Hive.openBox(_boxName);
    lang = AppLang.values.firstWhere(
      (e) => e.name == (_box.get('lang') as String? ?? 'tr'),
      orElse: () => AppLang.tr,
    );
    developerName =
        (_box.get('developerName') as String?)?.trim().isNotEmpty == true
            ? (_box.get('developerName') as String).trim()
            : 'Ali Dinçer';
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

  Future<void> setDeveloperName(String value) async {
    final v = value.trim().isEmpty ? 'Ali Dinçer' : value.trim();
    developerName = v;
    await _box.put('developerName', v);
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
